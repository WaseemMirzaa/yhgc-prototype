import 'dart:async';

import 'package:get/get.dart';
import 'package:yhgc_mobile_app/src/controllers/auth_controller.dart';
import 'package:yhgc_mobile_app/src/data/models.dart';
import 'package:yhgc_mobile_app/src/data/repository.dart';

class AppController extends GetxController {
  AppController({required this.repository});
  final AppRepository repository;

  StreamSubscription<PortfolioSnapshot>? _livePortfolioSub;

  final tab = 0.obs;
  final companies = <Company>[].obs;
  final properties = <Property>[].obs;
  final invoices = <Invoice>[].obs;
  final documents = <PortfolioDocument>[].obs;
  final files = <PortfolioFile>[].obs;
  final financeRecords = <FinanceRecord>[].obs;
  final incomeRows = <IncomeRow>[].obs;
  final insuranceRecords = <InsuranceRecord>[].obs;
  final constructionProjects = <ConstructionProject>[].obs;
  final constructionStages = <ConstructionStage>[].obs;
  final notifications = <PortfolioNotification>[].obs;
  final unread = 0.obs;
  final loading = false.obs;

  int _syntheticAlertCount() {
    return properties.where((p) => p.progress < 100).length +
        invoices.where((i) => i.status != 'Paid').length;
  }

  void _syncUnread() {
    unread.value = notifications.length + _syntheticAlertCount();
  }

  @override
  void onInit() {
    super.onInit();
    final auth = Get.find<AuthController>();
    ever<int>(auth.portfolioScopeEpoch, (_) {
      if (repository.portfolioSnapshotStream != null) {
        unawaited(refreshFirebasePortfolio());
      }
    });

    final live = repository.portfolioSnapshotStream;
    if (live != null) {
      loading.value = true;
      void tryBind() {
        if (!auth.sessionReady.value || _livePortfolioSub != null) return;
        _livePortfolioSub = live.listen(
          _applyLiveSnapshot,
          onError: (_) => loading.value = false,
        );
      }

      if (auth.sessionReady.value) {
        tryBind();
      } else {
        ever<bool>(auth.sessionReady, (ready) {
          if (ready) tryBind();
        });
      }
    } else {
      load();
    }
  }

  @override
  void onClose() {
    _livePortfolioSub?.cancel();
    super.onClose();
  }

  void _applyLiveSnapshot(PortfolioSnapshot s) {
    companies.assignAll(s.companies);
    properties.assignAll(s.properties);
    invoices.assignAll(s.invoices);
    documents.assignAll(s.documents);
    files.assignAll(s.files);
    financeRecords.assignAll(s.financeRecords);
    incomeRows.assignAll(s.incomeRows);
    insuranceRecords.assignAll(s.insuranceRecords);
    constructionProjects.assignAll(s.constructionProjects);
    constructionStages.assignAll(s.constructionStages);
    notifications.assignAll(s.notifications);
    loading.value = false;
    _syncUnread();
  }

  Future<void> load() async {
    if (repository.portfolioSnapshotStream != null) return;
    loading.value = true;
    try {
      companies.assignAll(await repository.companies());
      properties.assignAll(await repository.properties());
      invoices.assignAll(await repository.invoices());
      documents.assignAll(await repository.documents());
      files.assignAll(await repository.portfolioFiles());
      financeRecords.assignAll(await repository.financeRecords());
      incomeRows.assignAll(await repository.incomeRows());
      insuranceRecords.assignAll(await repository.insuranceRecords());
      constructionProjects.assignAll(await repository.constructionProjects());
      constructionStages.assignAll(await repository.constructionStages());
      notifications.clear();
    } finally {
      loading.value = false;
      _syncUnread();
    }
  }

  Future<String> createAccountantShareLink({
    required String scopeType,
    required String scopeId,
    required DateTime expiresAt,
  }) {
    return repository.createAccountantShareLink(
      scopeType: scopeType,
      scopeId: scopeId,
      expiresAt: expiresAt,
    );
  }

  Future<void> refreshFirebasePortfolio() async {
    final r = repository;
    if (r is! FirebaseRepository) return;
    loading.value = true;
    try {
      final snap = await r.pullScopedPortfolioSnapshot();
      _applyLiveSnapshot(snap);
    } catch (_) {
      // keep existing lists on failure
    } finally {
      loading.value = false;
    }
  }

  /// Updates invoice paid state in mock or Firestore. Returns an error message on failure.
  Future<String?> setInvoicePaidState(String invoiceId, {required bool paid}) async {
    try {
      final ok = await repository.updateInvoiceStatus(invoiceId, paid: paid);
      if (!ok) return 'Could not update this invoice.';
      if (repository.portfolioSnapshotStream != null) {
        await refreshFirebasePortfolio();
      } else {
        invoices.assignAll(await repository.invoices());
      }
      _syncUnread();
      return null;
    } catch (_) {
      return 'Update failed. Please try again.';
    }
  }

  Future<String?> deleteClientAccount(String? clientId) async {
    loading.value = true;
    try {
      final err = await repository.deleteClientAccount(clientId);
      if (err != null) return err;
      companies.clear();
      properties.clear();
      invoices.clear();
      documents.clear();
      files.clear();
      financeRecords.clear();
      incomeRows.clear();
      insuranceRecords.clear();
      constructionProjects.clear();
      constructionStages.clear();
      notifications.clear();
      unread.value = 0;
      tab.value = 0;
      return null;
    } finally {
      loading.value = false;
    }
  }
}

