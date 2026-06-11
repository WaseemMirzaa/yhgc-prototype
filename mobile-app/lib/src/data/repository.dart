import 'dart:async';
import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:yhgc_mobile_app/src/config/app_settings.dart';
import 'package:yhgc_mobile_app/src/data/client_login_gate.dart';
import 'package:yhgc_mobile_app/src/data/models.dart';

abstract class AppRepository {
  /// Live Firestore document updates; null when [appSettings.useLiveFirestore] is false.
  Stream<PortfolioSnapshot>? get portfolioSnapshotStream;

  /// When using [FirebaseRepository], restricts parsed portfolio to this `clients[].id`.
  void setPortfolioClientScope(String? clientId) {}

  Future<List<Company>> companies();
  Future<List<Property>> properties();
  Future<List<Invoice>> invoices();
  Future<List<PortfolioDocument>> documents();
  Future<List<PortfolioFile>> portfolioFiles();
  /// Persists `paid` / `unpaid` to backing store (mock map or Firestore). Returns false if not allowed or missing.
  Future<bool> updateInvoiceStatus(String invoiceId, {required bool paid});
  Future<List<FinanceRecord>> financeRecords();
  Future<List<IncomeRow>> incomeRows();
  Future<List<InsuranceRecord>> insuranceRecords();
  Future<List<ConstructionProject>> constructionProjects();
  Future<List<ConstructionStage>> constructionStages();
  Future<String?> deleteClientAccount(String? clientId);
  Future<String> createAccountantShareLink({
    required String scopeType,
    required String scopeId,
    required DateTime expiresAt,
  });
  Future<ClientLoginAccess> checkClientLoginAccess(String loginCode);
}

/// One materialized view of `appSnapshots/adminPrototype` for the mobile UI.
class PortfolioSnapshot {
  const PortfolioSnapshot({
    required this.companies,
    required this.properties,
    required this.invoices,
    required this.documents,
    required this.files,
    required this.financeRecords,
    required this.incomeRows,
    required this.insuranceRecords,
    required this.constructionProjects,
    required this.constructionStages,
    required this.notifications,
  });

  final List<Company> companies;
  final List<Property> properties;
  final List<Invoice> invoices;
  final List<PortfolioDocument> documents;
  final List<PortfolioFile> files;
  final List<FinanceRecord> financeRecords;
  final List<IncomeRow> incomeRows;
  final List<InsuranceRecord> insuranceRecords;
  final List<ConstructionProject> constructionProjects;
  final List<ConstructionStage> constructionStages;
  final List<PortfolioNotification> notifications;
}

Future<PortfolioSnapshot> buildPortfolioSnapshotFromMap(
  Map<String, dynamic>? data,
  MockRepository fallback, {
  String? scopeClientId,
}) async {
  if (data == null) {
    return PortfolioSnapshot(
      companies: await fallback.companies(),
      properties: await fallback.properties(),
      invoices: await fallback.invoices(),
      documents: await fallback.documents(),
      files: await fallback.portfolioFiles(),
      financeRecords: await fallback.financeRecords(),
      incomeRows: await fallback.incomeRows(),
      insuranceRecords: await fallback.insuranceRecords(),
      constructionProjects: await fallback.constructionProjects(),
      constructionStages: await fallback.constructionStages(),
      notifications: const [],
    );
  }
  Map<String, dynamic> effective = Map<String, dynamic>.from(data);
  if (scopeClientId != null && scopeClientId.isNotEmpty) {
    effective = _scopedFirestoreDataForClient(effective, scopeClientId);
  }
  final projects = _fbParseProjects(effective);
  final stages = _fbParseStages(effective);
  final files = _fbParsePortfolioFiles(effective, projects, stages);
  return PortfolioSnapshot(
    companies: _fbCompanies(effective),
    invoices: _fbInvoices(effective),
    properties: _fbProperties(effective, projects, stages),
    documents: _fbDocuments(effective),
    files: files,
    financeRecords: _fbParseFinance(effective),
    incomeRows: _fbParseIncome(effective),
    insuranceRecords: _fbParseInsurance(effective),
    constructionProjects: projects,
    constructionStages: stages,
    notifications: _fbNotifications(effective),
  );
}

String _formatDirectorsField(dynamic raw) {
  if (raw == null) return '-';
  if (raw is String) return raw.isEmpty ? '-' : raw;
  if (raw is List) {
    final parts = raw.map((e) => e.toString()).where((s) => s.isNotEmpty).toList();
    return parts.isEmpty ? '-' : parts.join(', ');
  }
  return raw.toString();
}

List<Company> _fbCompanies(Map<String, dynamic> data) {
  return _snapshotList(data, 'companies')
      .map(
        (item) => Company(
          id: (item['id'] ?? '').toString(),
          name: (item['name'] ?? 'Company').toString(),
          companyNo: (item['companyNumber'] ?? '-').toString(),
          address: (item['registeredAddress'] ?? '-').toString(),
          directors: _formatDirectorsField(item['directors']),
          dueDate: (item['nextAccountsDueDate'] ?? '-').toString(),
        ),
      )
      .toList();
}

List<PortfolioNotification> _fbNotifications(Map<String, dynamic> data) {
  return _snapshotList(data, 'notifications')
      .map(
        (item) => PortfolioNotification(
          id: (item['id'] ?? '').toString(),
          title: (item['title'] ?? 'Update').toString(),
          body: (item['body'] ?? '').toString(),
          createdAt: (item['createdAt'] ?? '').toString(),
          type: (item['type'] ?? '').toString(),
        ),
      )
      .toList();
}

List<Invoice> _fbInvoices(Map<String, dynamic> data) {
  final invoiceAssetUrlById = <String, String>{};
  final invoiceAssetUrlsById = <String, List<String>>{};
  final propertyInvoiceQueues = <String, List<String>>{};

  for (final item in _snapshotList(data, 'assets')) {
    final ownerType = (item['ownerType'] ?? '').toString();
    final tag = (item['tag'] ?? '').toString();
    final url = (item['urlOrPath'] ?? '').toString();
    if (url.isEmpty) continue;
    if (ownerType == 'invoice') {
      final ownerId = (item['ownerId'] ?? '').toString();
      if (ownerId.isNotEmpty) {
        invoiceAssetUrlById[ownerId] = url;
        invoiceAssetUrlsById.putIfAbsent(ownerId, () => []).add(url);
      }
    }
    if (ownerType == 'property' && tag == 'invoice') {
      final pid = (item['ownerId'] ?? '').toString();
      if (pid.isNotEmpty) {
        propertyInvoiceQueues.putIfAbsent(pid, () => []).add(url);
      }
    }
  }

  return _snapshotList(data, 'invoices')
      .map(
        (item) {
          final id = (item['id'] ?? '').toString();
          final propertyId = (item['propertyId'] ?? '').toString();
          var docUrl = (item['pdfUrl'] ?? '').toString();
          if (docUrl.isEmpty) {
            docUrl = invoiceAssetUrlById[id] ?? '';
          }
          if (docUrl.isEmpty) {
            final q = propertyInvoiceQueues[propertyId];
            if (q != null && q.isNotEmpty) {
              docUrl = q.removeAt(0);
            }
          }
          final fromAssets = List<String>.from(invoiceAssetUrlsById[id] ?? const []);
          final allUrls = <String>[];
          if (docUrl.isNotEmpty) allUrls.add(_safeUrl(docUrl));
          for (final u in fromAssets) {
            final s = _safeUrl(u);
            if (s.isNotEmpty && !allUrls.contains(s)) allUrls.add(s);
          }
          final primary = allUrls.isNotEmpty ? allUrls.first : _safeUrl(docUrl);
          return Invoice(
            id: id,
            propertyId: propertyId,
            supplier: (item['supplierName'] ?? '-').toString(),
            ref: (item['invoiceRef'] ?? '-').toString(),
            date: (item['invoiceDate'] ?? '-').toString(),
            amount: ((item['amount'] as num?) ?? 0).toDouble(),
            status: _invoiceStatusLabel((item['status'] ?? 'unpaid').toString()),
            documentUrl: primary,
            fileUrls: allUrls,
          );
        },
      )
      .toList();
}

List<Property> _fbProperties(
  Map<String, dynamic> data,
  List<ConstructionProject> projects,
  List<ConstructionStage> stages,
) {
  return _snapshotList(data, 'properties')
      .map(
        (item) {
          final id = (item['id'] ?? '').toString();
          final progressRaw = item['progress'];
          final progress = progressRaw is num
              ? progressRaw.toInt().clamp(0, 100)
              : constructionProgressPercent(id, projects, stages);
          final currentValue = (item['currentValue'] as num?)?.toDouble() ?? 0;
          final monthlyNet = (item['monthlyNet'] as num?)?.toDouble() ?? 0;
          final purchasePrice = (item['purchasePrice'] as num?)?.toDouble();
          final incomeToDate = (item['incomeToDate'] as num?)?.toDouble();
          final costToDate = (item['costToDate'] as num?)?.toDouble();
          final netPosition = (item['netPosition'] as num?)?.toDouble();
          return Property(
            id: id,
            companyId: (item['companyId'] ?? '').toString(),
            title: (item['title'] ?? '').toString(),
            address: (item['address'] ?? '-').toString(),
            type: (item['propertyType'] ?? '-').toString(),
            status: _normalizeStatus((item['status'] ?? '').toString()),
            progress: progress,
            value: currentValue,
            net: monthlyNet,
            purchasePriceLabel: purchasePrice != null ? _moneyLabel(purchasePrice) : null,
            insuranceRenewalDate: item['insuranceRenewalDate']?.toString(),
            tenancyStatus: item['tenancyStatus']?.toString(),
            managingAgent: item['managingAgent']?.toString(),
            incomeToDateLabel: incomeToDate != null ? _moneyLabel(incomeToDate) : null,
            costToDateLabel: costToDate != null ? _moneyLabel(costToDate) : null,
            netPositionLabel: netPosition != null ? _moneyLabel(netPosition) : null,
          );
        },
      )
      .toList();
}

List<PortfolioDocument> _fbDocuments(Map<String, dynamic> data) {
  return _snapshotList(data, 'assets')
      .where((item) => (item['ownerType'] ?? '').toString() == 'property')
      .map(
        (item) => PortfolioDocument(
          id: (item['id'] ?? '').toString(),
          propertyId: (item['ownerId'] ?? '').toString(),
          name: (item['fileName'] ?? 'Document').toString(),
          type: _normalizeDocType((item['tag'] ?? '').toString()),
          uploadedAt: (item['createdAt'] ?? '-').toString(),
          fileUrl: _safeUrl((item['urlOrPath'] ?? '').toString()),
        ),
      )
      .toList();
}

List<ConstructionProject> _fbParseProjects(Map<String, dynamic> data) {
  return _snapshotList(data, 'constructionProjects')
      .map(
        (item) => ConstructionProject(
          id: (item['id'] ?? '').toString(),
          propertyId: (item['propertyId'] ?? '').toString(),
          totalWeeks: ((item['totalWeeks'] as num?) ?? 0).toInt(),
          completedStages: ((item['completedStages'] as num?) ?? 0).toInt(),
          startDate: item['startDate']?.toString(),
          expectedCompletionDate: item['expectedCompletionDate']?.toString(),
        ),
      )
      .toList();
}

List<ConstructionStage> _fbParseStages(Map<String, dynamic> data) {
  return _snapshotList(data, 'constructionStages')
      .map(
        (item) => ConstructionStage(
          id: (item['id'] ?? '').toString(),
          projectId: (item['projectId'] ?? '').toString(),
          weekNumber: ((item['weekNumber'] as num?) ?? 0).toInt(),
          uploadDate: (item['uploadDate'] ?? '').toString(),
        ),
      )
      .toList();
}

String? _propertyIdForConstructionStage(
  String stageId,
  List<ConstructionStage> stages,
  List<ConstructionProject> projects,
) {
  for (final s in stages) {
    if (s.id != stageId) continue;
    for (final p in projects) {
      if (p.id == s.projectId) return p.propertyId;
    }
  }
  return null;
}

List<PortfolioFile> _fbParsePortfolioFiles(
  Map<String, dynamic> data,
  List<ConstructionProject> projects,
  List<ConstructionStage> stages,
) {
  final invoiceRows = _snapshotList(data, 'invoices');
  final invoiceProperty = <String, String>{};
  for (final inv in invoiceRows) {
    final id = (inv['id'] ?? '').toString();
    final pid = (inv['propertyId'] ?? '').toString();
    if (id.isNotEmpty && pid.isNotEmpty) invoiceProperty[id] = pid;
  }
  final financeProperty = <String, String>{};
  for (final f in _snapshotList(data, 'financeRecords')) {
    final id = (f['id'] ?? '').toString();
    final pid = (f['propertyId'] ?? '').toString();
    if (id.isNotEmpty && pid.isNotEmpty) financeProperty[id] = pid;
  }
  final insuranceProperty = <String, String>{};
  for (final i in _snapshotList(data, 'insuranceRecords')) {
    final id = (i['id'] ?? '').toString();
    final pid = (i['propertyId'] ?? '').toString();
    if (id.isNotEmpty && pid.isNotEmpty) insuranceProperty[id] = pid;
  }

  final out = <PortfolioFile>[];
  for (final item in _snapshotList(data, 'assets')) {
    final id = (item['id'] ?? '').toString();
    final ownerType = (item['ownerType'] ?? '').toString();
    final ownerId = (item['ownerId'] ?? '').toString();
    final tag = (item['tag'] ?? '').toString();
    final rawUrl = (item['urlOrPath'] ?? '').toString();
    if (rawUrl.isEmpty || rawUrl.startsWith('local://')) continue;
    final url = _safeUrl(rawUrl);
    final fileName = (item['fileName'] ?? 'File').toString();
    final mime = (item['mimeType'] ?? '').toString();
    final createdAt = item['createdAt']?.toString();

    String? resolvedPropertyId;
    if (ownerType == 'property') {
      resolvedPropertyId = ownerId;
    } else if (ownerType == 'construction_stage') {
      resolvedPropertyId = _propertyIdForConstructionStage(ownerId, stages, projects);
    } else if (ownerType == 'invoice') {
      resolvedPropertyId = invoiceProperty[ownerId];
    } else if (ownerType == 'finance_record') {
      resolvedPropertyId = financeProperty[ownerId];
    } else if (ownerType == 'insurance_record') {
      resolvedPropertyId = insuranceProperty[ownerId];
    }
    if (resolvedPropertyId == null || resolvedPropertyId.isEmpty) continue;

    out.add(
      PortfolioFile(
        id: id,
        propertyId: resolvedPropertyId,
        ownerType: ownerType,
        ownerId: ownerId,
        tag: tag,
        fileName: fileName,
        mimeType: mime,
        urlOrPath: url,
        createdAt: createdAt,
      ),
    );
  }
  return out;
}

List<FinanceRecord> _fbParseFinance(Map<String, dynamic> data) {
  return _snapshotList(data, 'financeRecords')
      .map(
        (item) => FinanceRecord(
          id: (item['id'] ?? '').toString(),
          propertyId: (item['propertyId'] ?? '').toString(),
          financeType: item['financeType']?.toString(),
          lenderName: item['lenderName']?.toString(),
          lenderContactName: item['lenderContactName']?.toString(),
          lenderContactPhone: item['lenderContactPhone']?.toString(),
          loanAmount: (item['loanAmount'] as num?)?.toDouble(),
          monthlyPayment: (item['monthlyPayment'] as num?)?.toDouble(),
          interestRatePct: (item['interestRatePct'] as num?)?.toDouble(),
          ltvPct: (item['ltvPct'] as num?)?.toDouble(),
          termEndDate: item['termEndDate']?.toString(),
        ),
      )
      .toList();
}

List<IncomeRow> _fbParseIncome(Map<String, dynamic> data) {
  return _snapshotList(data, 'incomeRows')
      .map(
        (item) => IncomeRow(
          id: (item['id'] ?? '').toString(),
          propertyId: (item['propertyId'] ?? '').toString(),
          period: (item['period'] ?? '').toString(),
          incomeAmount: ((item['incomeAmount'] as num?) ?? 0).toDouble(),
          costAmount: ((item['costAmount'] as num?) ?? 0).toDouble(),
        ),
      )
      .toList();
}

List<InsuranceRecord> _fbParseInsurance(Map<String, dynamic> data) {
  return _snapshotList(data, 'insuranceRecords')
      .map(
        (item) => InsuranceRecord(
          id: (item['id'] ?? '').toString(),
          propertyId: (item['propertyId'] ?? '').toString(),
          insurerName: item['insurerName']?.toString(),
          policyNumber: item['policyNumber']?.toString(),
          coverStartDate: item['coverStartDate']?.toString(),
          coverEndDate: item['coverEndDate']?.toString(),
          renewal60DayAlertOn: item['renewal60DayAlertOn']?.toString(),
          renewal14DayAlertOn: item['renewal14DayAlertOn']?.toString(),
        ),
      )
      .toList();
}

List<Map<String, dynamic>> _snapshotList(Map<String, dynamic>? data, String key) {
  if (data == null) return [];
  final raw = data[key];
  if (raw is! List) return [];
  return raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
}

/// Returns [data] with list fields trimmed to entities owned by [scopeClientId].
Map<String, dynamic> _scopedFirestoreDataForClient(
  Map<String, dynamic> data,
  String scopeClientId,
) {
  bool ownClient(Map<String, dynamic> m) =>
      (m['clientId'] ?? '').toString() == scopeClientId;

  final companies = _snapshotList(data, 'companies').where(ownClient).toList();
  final properties = _snapshotList(data, 'properties').where(ownClient).toList();
  final propertyIds =
      properties.map((m) => (m['id'] ?? '').toString()).where((s) => s.isNotEmpty).toSet();

  final projects = _snapshotList(data, 'constructionProjects')
      .where((m) => propertyIds.contains((m['propertyId'] ?? '').toString()))
      .toList();
  final projectIds =
      projects.map((m) => (m['id'] ?? '').toString()).where((s) => s.isNotEmpty).toSet();

  final stages = _snapshotList(data, 'constructionStages')
      .where((m) => projectIds.contains((m['projectId'] ?? '').toString()))
      .toList();
  final stageIds =
      stages.map((m) => (m['id'] ?? '').toString()).where((s) => s.isNotEmpty).toSet();

  final invoices = _snapshotList(data, 'invoices')
      .where((m) => propertyIds.contains((m['propertyId'] ?? '').toString()))
      .toList();
  final invoiceIds =
      invoices.map((m) => (m['id'] ?? '').toString()).where((s) => s.isNotEmpty).toSet();

  final financeRecords = _snapshotList(data, 'financeRecords')
      .where((m) => propertyIds.contains((m['propertyId'] ?? '').toString()))
      .toList();
  final financeIds =
      financeRecords.map((m) => (m['id'] ?? '').toString()).where((s) => s.isNotEmpty).toSet();

  final insuranceRecords = _snapshotList(data, 'insuranceRecords')
      .where((m) => propertyIds.contains((m['propertyId'] ?? '').toString()))
      .toList();
  final insuranceIds =
      insuranceRecords.map((m) => (m['id'] ?? '').toString()).where((s) => s.isNotEmpty).toSet();

  bool keepAsset(Map<String, dynamic> m) {
    final ot = (m['ownerType'] ?? '').toString();
    final oid = (m['ownerId'] ?? '').toString();
    switch (ot) {
      case 'property':
        return propertyIds.contains(oid);
      case 'invoice':
        return invoiceIds.contains(oid);
      case 'construction_stage':
        return stageIds.contains(oid);
      case 'finance_record':
        return financeIds.contains(oid);
      case 'insurance_record':
        return insuranceIds.contains(oid);
      case 'client':
        return oid == scopeClientId;
      default:
        return false;
    }
  }

  final assets = _snapshotList(data, 'assets').where(keepAsset).toList();

  final incomeRows = _snapshotList(data, 'incomeRows')
      .where((m) => propertyIds.contains((m['propertyId'] ?? '').toString()))
      .toList();

  final notifications = _snapshotList(data, 'notifications').where(ownClient).toList();

  final clients = _snapshotList(data, 'clients').where(ownClient).toList();

  data['companies'] = companies;
  data['properties'] = properties;
  data['constructionProjects'] = projects;
  data['constructionStages'] = stages;
  data['invoices'] = invoices;
  data['assets'] = assets;
  data['financeRecords'] = financeRecords;
  data['incomeRows'] = incomeRows;
  data['insuranceRecords'] = insuranceRecords;
  data['notifications'] = notifications;
  data['clients'] = clients;
  return data;
}

int constructionProgressPercent(
  String propertyId,
  List<ConstructionProject> projects,
  List<ConstructionStage> stages,
) {
  ConstructionProject? p;
  for (final x in projects) {
    if (x.propertyId == propertyId) {
      p = x;
      break;
    }
  }
  if (p == null || p.totalWeeks <= 0) return 0;
  final proj = p;
  final nStages = stages.where((s) => s.projectId == proj.id).length;
  final done = nStages > proj.completedStages ? nStages : proj.completedStages;
  final pct = (done * 100 / proj.totalWeeks).floor();
  return pct.clamp(0, 100);
}

String _invoiceStatusLabel(String raw) {
  switch (raw.toLowerCase()) {
    case 'paid':
      return 'Paid';
    case 'unpaid':
      return 'Unpaid';
    case 'queried':
      return 'Queried';
    default:
      if (raw.isEmpty) return 'Unpaid';
      return raw[0].toUpperCase() + raw.substring(1).toLowerCase();
  }
}

String _safeUrl(String value) {
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  return 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
}

String _moneyLabel(num? v) {
  if (v == null) return '';
  return '£${v.toStringAsFixed(0)}';
}

class MockRepository implements AppRepository {
  final _random = Random();

  /// Firestore-style status: `paid` | `unpaid` | `queried` (overrides seed display).
  final Map<String, String> _invoiceStatusOverrides = {};

  @override
  void setPortfolioClientScope(String? clientId) {}

  @override
  Stream<PortfolioSnapshot>? get portfolioSnapshotStream => null;

  String _token() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return List.generate(32, (_) => chars[_random.nextInt(chars.length)]).join();
  }

  /// Mirrors admin-web `src/data/seed.ts` shape and IDs for consistent mock / Firebase parity.
  static const _projects = [
    ConstructionProject(
      id: 'project-1',
      propertyId: 'property-1',
      totalWeeks: 10,
      completedStages: 4,
      startDate: '2026-02-01',
      expectedCompletionDate: '2026-05-01',
    ),
    ConstructionProject(
      id: 'project-2',
      propertyId: 'property-2',
      totalWeeks: 6,
      completedStages: 2,
      startDate: '2025-11-01',
      expectedCompletionDate: '2026-01-20',
    ),
  ];

  static const _stages = [
    ConstructionStage(id: 'stage-1', projectId: 'project-1', weekNumber: 1, uploadDate: '2026-02-07'),
    ConstructionStage(id: 'stage-2', projectId: 'project-1', weekNumber: 2, uploadDate: '2026-02-14'),
    ConstructionStage(id: 'stage-3', projectId: 'project-1', weekNumber: 3, uploadDate: '2026-02-21'),
    ConstructionStage(id: 'stage-4', projectId: 'project-1', weekNumber: 4, uploadDate: '2026-02-28'),
    ConstructionStage(id: 'stage-p2-1', projectId: 'project-2', weekNumber: 1, uploadDate: '2025-11-08'),
    ConstructionStage(id: 'stage-p2-2', projectId: 'project-2', weekNumber: 2, uploadDate: '2025-11-15'),
  ];

  @override
  Future<List<Company>> companies() async => const [
        Company(
          id: 'company-1',
          name: 'Aarav Holdings UK Ltd',
          companyNo: '11223344',
          address: '10 Bishopsgate, London',
          directors: 'Aarav Shah',
          dueDate: '2026-12-20',
        ),
      ];

  static const List<Invoice> _mockInvoicesSeed = [
    Invoice(
      id: 'inv-1',
      propertyId: 'property-1',
      supplier: 'BuildCo Structures Ltd',
      ref: 'BC-440',
      date: '2026-03-15',
      amount: 24000,
      status: 'Unpaid',
      documentUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      fileUrls: [
        'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        'https://www.orimi.com/pdf-test.pdf',
      ],
    ),
    Invoice(
      id: 'inv-1b',
      propertyId: 'property-1',
      supplier: 'Northern Scaffold Co',
      ref: 'NSC-2026-118',
      date: '2026-02-28',
      amount: 8750,
      status: 'Paid',
      documentUrl: 'https://www.orimi.com/pdf-test.pdf',
      fileUrls: ['https://www.orimi.com/pdf-test.pdf'],
    ),
    Invoice(
      id: 'inv-1c',
      propertyId: 'property-1',
      supplier: 'MEP Design Partners',
      ref: 'MEP-7781',
      date: '2026-03-02',
      amount: 4200,
      status: 'Queried',
      documentUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      fileUrls: ['https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'],
    ),
    Invoice(
      id: 'inv-2',
      propertyId: 'property-2',
      supplier: 'Leeds Facilities Management',
      ref: 'LFM-Q1-992',
      date: '2026-03-10',
      amount: 1850,
      status: 'Paid',
      documentUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      fileUrls: ['https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'],
    ),
    Invoice(
      id: 'inv-2b',
      propertyId: 'property-2',
      supplier: 'Yorkshire Window Co',
      ref: 'YWC-4410',
      date: '2026-03-22',
      amount: 6400,
      status: 'Unpaid',
      documentUrl: 'https://www.orimi.com/pdf-test.pdf',
      fileUrls: ['https://www.orimi.com/pdf-test.pdf'],
    ),
  ];

  @override
  Future<List<Invoice>> invoices() async {
    return _mockInvoicesSeed
        .map(
          (inv) {
            final o = _invoiceStatusOverrides[inv.id];
            if (o == null) return inv;
            return Invoice(
              id: inv.id,
              propertyId: inv.propertyId,
              supplier: inv.supplier,
              ref: inv.ref,
              date: inv.date,
              amount: inv.amount,
              status: _invoiceStatusLabel(o),
              documentUrl: inv.documentUrl,
              fileUrls: inv.fileUrls,
            );
          },
        )
        .toList();
  }

  @override
  Future<bool> updateInvoiceStatus(String invoiceId, {required bool paid}) async {
    if (!_mockInvoicesSeed.any((e) => e.id == invoiceId)) return false;
    _invoiceStatusOverrides[invoiceId] = paid ? 'paid' : 'unpaid';
    return true;
  }

  @override
  Future<List<Property>> properties() async {
    const p1 = Property(
      id: 'property-1',
      companyId: 'company-1',
      title: 'Office Block - Manchester',
      address: '22 Market St, Manchester',
      type: 'Commercial',
      status: 'In Construction',
      progress: 40,
      value: 2200000,
      net: 14280,
      purchasePriceLabel: '£1980000',
      insuranceRenewalDate: '2026-11-01',
      tenancyStatus: 'Pre-let agreed (anchor tenant)',
      managingAgent: 'Knight Frank Manchester',
      incomeToDateLabel: '£55200',
      costToDateLabel: '£128400',
      netPositionLabel: '£-73100',
    );
    const p2 = Property(
      id: 'property-2',
      companyId: 'company-1',
      title: 'Riverside Apartments - Leeds',
      address: '8 Wharf Approach, Leeds',
      type: 'Residential (BTR)',
      status: 'Fully Tenanted',
      progress: 33,
      value: 980000,
      net: 6100,
      purchasePriceLabel: '£820000',
      insuranceRenewalDate: '2026-09-18',
      tenancyStatus: 'Fully let (98% occupancy)',
      managingAgent: 'Savills Residential',
      incomeToDateLabel: '£412000',
      costToDateLabel: '£98500',
      netPositionLabel: '£313500',
    );
    return const [p1, p2];
  }

  @override
  Future<List<PortfolioDocument>> documents() async => const [
        PortfolioDocument(
          id: 'asset-p1-gen-1',
          propertyId: 'property-1',
          name: 'Property information memorandum.pdf',
          type: 'General',
          uploadedAt: '2026-02-10T11:20:00.000Z',
          fileUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        ),
        PortfolioDocument(
          id: 'asset-p1-con',
          propertyId: 'property-1',
          name: 'Week 3 site photos.zip',
          type: 'Construction',
          uploadedAt: '2026-02-22T16:40:00.000Z',
          fileUrl: 'https://www.orimi.com/pdf-test.pdf',
        ),
        PortfolioDocument(
          id: 'asset-p1-fin',
          propertyId: 'property-1',
          name: 'HSBC facility letter (signed).pdf',
          type: 'Finance',
          uploadedAt: '2026-03-01T14:00:00.000Z',
          fileUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        ),
        PortfolioDocument(
          id: 'asset-p1-inv',
          propertyId: 'property-1',
          name: 'BuildCo_BC-440_scan.pdf',
          type: 'Invoice',
          uploadedAt: '2026-03-16T10:12:00.000Z',
          fileUrl: 'https://www.orimi.com/pdf-test.pdf',
        ),
        PortfolioDocument(
          id: 'asset-p1-ins',
          propertyId: 'property-1',
          name: 'AXA schedule of cover.pdf',
          type: 'Insurance',
          uploadedAt: '2026-01-05T13:30:00.000Z',
          fileUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        ),
        PortfolioDocument(
          id: 'asset-p2-gen',
          propertyId: 'property-2',
          name: 'Tenant handbook 2026.pdf',
          type: 'General',
          uploadedAt: '2026-01-20T12:00:00.000Z',
          fileUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        ),
        PortfolioDocument(
          id: 'asset-p2-ins',
          propertyId: 'property-2',
          name: 'Aviva policy schedule.pdf',
          type: 'Insurance',
          uploadedAt: '2025-09-02T10:00:00.000Z',
          fileUrl: 'https://www.orimi.com/pdf-test.pdf',
        ),
      ];

  static const List<PortfolioFile> _mockFilesSeed = [
    PortfolioFile(
      id: 'mf-p1-gen',
      propertyId: 'property-1',
      ownerType: 'property',
      ownerId: 'property-1',
      tag: 'general',
      fileName: 'Property information memorandum.pdf',
      mimeType: 'application/pdf',
      urlOrPath: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      createdAt: '2026-02-10T11:20:00.000Z',
    ),
    PortfolioFile(
      id: 'mf-s1-img',
      propertyId: 'property-1',
      ownerType: 'construction_stage',
      ownerId: 'stage-1',
      tag: 'construction',
      fileName: 'Week 1 elevation.jpg',
      mimeType: 'image/jpeg',
      urlOrPath: 'https://picsum.photos/id/1018/800/600',
      createdAt: '2026-02-07T12:00:00.000Z',
    ),
    PortfolioFile(
      id: 'mf-s1-vid',
      propertyId: 'property-1',
      ownerType: 'construction_stage',
      ownerId: 'stage-1',
      tag: 'construction',
      fileName: 'Site walkthrough.mp4',
      mimeType: 'video/mp4',
      urlOrPath: 'https://flutter.github.io/assets-for-api-docs/assets/videos/bee.mp4',
      createdAt: '2026-02-07T12:05:00.000Z',
    ),
    PortfolioFile(
      id: 'mf-fin1',
      propertyId: 'property-1',
      ownerType: 'finance_record',
      ownerId: 'fin-1',
      tag: 'finance',
      fileName: 'HSBC facility letter.pdf',
      mimeType: 'application/pdf',
      urlOrPath: 'https://www.orimi.com/pdf-test.pdf',
      createdAt: '2026-03-01T14:00:00.000Z',
    ),
    PortfolioFile(
      id: 'mf-inv1',
      propertyId: 'property-1',
      ownerType: 'invoice',
      ownerId: 'inv-1',
      tag: 'invoice',
      fileName: 'BC-440_scan.pdf',
      mimeType: 'application/pdf',
      urlOrPath: 'https://www.orimi.com/pdf-test.pdf',
      createdAt: '2026-03-16T10:12:00.000Z',
    ),
    PortfolioFile(
      id: 'mf-ins1',
      propertyId: 'property-1',
      ownerType: 'insurance_record',
      ownerId: 'ins-1',
      tag: 'insurance',
      fileName: 'AXA schedule.pdf',
      mimeType: 'application/pdf',
      urlOrPath: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      createdAt: '2026-01-05T13:30:00.000Z',
    ),
    PortfolioFile(
      id: 'mf-p2-gen',
      propertyId: 'property-2',
      ownerType: 'property',
      ownerId: 'property-2',
      tag: 'general',
      fileName: 'Tenant handbook.pdf',
      mimeType: 'application/pdf',
      urlOrPath: 'https://www.orimi.com/pdf-test.pdf',
      createdAt: '2026-01-20T12:00:00.000Z',
    ),
  ];

  @override
  Future<List<PortfolioFile>> portfolioFiles() async => _mockFilesSeed;

  @override
  Future<List<FinanceRecord>> financeRecords() async => const [
        FinanceRecord(
          id: 'fin-1',
          propertyId: 'property-1',
          financeType: 'development_finance',
          lenderName: 'HSBC UK Bank plc',
          lenderContactName: 'Sarah Mitchell',
          lenderContactPhone: '+44 161 555 0142',
          loanAmount: 1450000,
          monthlyPayment: 11820,
          interestRatePct: 6.35,
          ltvPct: 62,
          termEndDate: '2027-04-30',
        ),
        FinanceRecord(
          id: 'fin-1b',
          propertyId: 'property-1',
          financeType: 'bridging_loan',
          lenderName: 'Metro Capital Partners',
          lenderContactName: 'James Okonkwo',
          lenderContactPhone: '+44 20 7946 0821',
          loanAmount: 220000,
          monthlyPayment: 2840,
          interestRatePct: 9.5,
          ltvPct: 12,
          termEndDate: '2026-12-15',
        ),
        FinanceRecord(
          id: 'fin-2',
          propertyId: 'property-2',
          financeType: 'mortgage',
          lenderName: 'Nationwide Building Society',
          lenderContactName: 'Priya Nair',
          lenderContactPhone: '+44 113 555 0199',
          loanAmount: 620000,
          monthlyPayment: 2890,
          interestRatePct: 5.19,
          ltvPct: 63,
          termEndDate: '2034-08-01',
        ),
      ];

  @override
  Future<List<IncomeRow>> incomeRows() async => const [
        IncomeRow(id: 'inc-1', propertyId: 'property-1', period: '2026-01', incomeAmount: 0, costAmount: 18400),
        IncomeRow(id: 'inc-1b', propertyId: 'property-1', period: '2026-02', incomeAmount: 0, costAmount: 22100),
        IncomeRow(id: 'inc-1c', propertyId: 'property-1', period: '2026-03', incomeAmount: 18400, costAmount: 4120),
        IncomeRow(id: 'inc-2', propertyId: 'property-2', period: '2026-02', incomeAmount: 18850, costAmount: 3200),
        IncomeRow(id: 'inc-2b', propertyId: 'property-2', period: '2026-03', incomeAmount: 19100, costAmount: 3150),
      ];

  @override
  Future<List<InsuranceRecord>> insuranceRecords() async => const [
        InsuranceRecord(
          id: 'ins-1',
          propertyId: 'property-1',
          insurerName: 'AXA Commercial',
          policyNumber: 'AXA-COM-9921',
          coverStartDate: '2025-11-01',
          coverEndDate: '2026-10-31',
          renewal60DayAlertOn: '2026-09-01',
          renewal14DayAlertOn: '2026-10-17',
        ),
        InsuranceRecord(
          id: 'ins-1b',
          propertyId: 'property-1',
          insurerName: 'Zurich Construction',
          policyNumber: 'ZUR-CAR-44102',
          coverStartDate: '2026-01-10',
          coverEndDate: '2027-01-09',
          renewal60DayAlertOn: '2026-11-10',
          renewal14DayAlertOn: '2026-12-26',
        ),
        InsuranceRecord(
          id: 'ins-2',
          propertyId: 'property-2',
          insurerName: 'Aviva Property Owners',
          policyNumber: 'AVI-PO-883341',
          coverStartDate: '2025-09-01',
          coverEndDate: '2026-08-31',
          renewal60DayAlertOn: '2026-07-02',
          renewal14DayAlertOn: '2026-08-17',
        ),
      ];

  @override
  Future<List<ConstructionProject>> constructionProjects() async => _projects;

  @override
  Future<List<ConstructionStage>> constructionStages() async => _stages;

  @override
  Future<String> createAccountantShareLink({
    required String scopeType,
    required String scopeId,
    required DateTime expiresAt,
  }) async {
    final token = _token();
    final base = appSettings.accountantPortalBaseUrl;
    return '$base/?portal=accountant&mode=mock&token=$token&scopeType=$scopeType&scopeId=$scopeId&expiresAt=${Uri.encodeComponent(expiresAt.toIso8601String())}';
  }

  @override
  Future<String?> deleteClientAccount(String? clientId) async => null;

  @override
  Future<ClientLoginAccess> checkClientLoginAccess(String loginCode) =>
      verifyClientLoginCode(loginCode);
}

class FirebaseRepository implements AppRepository {
  final MockRepository _fallback = MockRepository();
  final _db = FirebaseFirestore.instance;
  final _random = Random();
  static const List<String> _collectionKeys = <String>[
    'clients',
    'companies',
    'properties',
    'constructionProjects',
    'constructionStages',
    'financeRecords',
    'incomeRows',
    'invoices',
    'insuranceRecords',
    'assets',
    'notifications',
    'accountantLinks',
  ];

  /// When null, portfolio builds use a sentinel so no rows match (logged out).
  String? _portfolioClientId;

  static const String _kScopeLoggedOut = '__yhgc_logged_out__';

  /// Deduplicate parallel one-shot reads (e.g. multiple [AppRepository] calls in one frame).
  Future<Map<String, dynamic>?>? _snapshotInFlight;
  Future<PortfolioSnapshot>? _portfolioInFlight;

  @override
  void setPortfolioClientScope(String? clientId) {
    _portfolioClientId = clientId;
  }

  String _scopeForBuild() =>
      (_portfolioClientId != null && _portfolioClientId!.isNotEmpty)
          ? _portfolioClientId!
          : _kScopeLoggedOut;

  @override
  Stream<PortfolioSnapshot>? get portfolioSnapshotStream {
    if (!appSettings.firebase.isConfigured) return null;
    late final StreamController<PortfolioSnapshot> controller;
    final subs = <StreamSubscription<dynamic>>[];

    // Per-collection cache updated incrementally: each listener only refreshes its own
    // collection from the event it received, instead of re-reading all 12 on every change.
    final cache = <String, List<Map<String, dynamic>>>{
      for (final key in _collectionKeys) key: <Map<String, dynamic>>[],
    };
    Map<String, dynamic>? legacyDoc;
    final reported = <String>{};
    Timer? debounce;

    void emit() {
      final hasRows = _collectionKeys.any((k) => cache[k]!.isNotEmpty);
      final Map<String, dynamic>? data = hasRows
          ? <String, dynamic>{
              for (final key in _collectionKeys) key: cache[key],
              'updatedAt': DateTime.now().toIso8601String(),
            }
          : legacyDoc; // fall back to the legacy single-doc snapshot until collections exist
      unawaited(
        buildPortfolioSnapshotFromMap(data, _fallback, scopeClientId: _scopeForBuild())
            .then((next) {
          if (!controller.isClosed) controller.add(next);
        }),
      );
    }

    void scheduleEmit() {
      // Coalesce the burst of per-collection callbacks (one admin save touches several) into one rebuild.
      debounce?.cancel();
      debounce = Timer(const Duration(milliseconds: 60), () {
        if (reported.length < _collectionKeys.length) return; // wait for first full load
        emit();
      });
    }

    controller = StreamController<PortfolioSnapshot>(
      onListen: () {
        for (final key in _collectionKeys) {
          subs.add(
            _db.collection(key).snapshots().listen(
              (qs) {
                cache[key] = qs.docs.map((d) {
                  final m = Map<String, dynamic>.from(d.data());
                  m['id'] = d.id;
                  return m;
                }).toList();
                reported.add(key);
                scheduleEmit();
              },
              onError: (Object e, StackTrace st) {
                // Don't let one collection's error stall the "all reported" first paint.
                reported.add(key);
                controller.addError(e, st);
                scheduleEmit();
              },
            ),
          );
        }
        subs.add(
          _db
              .collection('appSnapshots')
              .doc('adminPrototype')
              .snapshots()
              .listen((doc) {
            legacyDoc = doc.data();
            scheduleEmit();
          }, onError: controller.addError),
        );
      },
      onCancel: () async {
        debounce?.cancel();
        for (final s in subs) {
          await s.cancel();
        }
      },
    );
    return controller.stream;
  }

  /// One server read, same scoping as [portfolioSnapshotStream] (e.g. after login).
  Future<PortfolioSnapshot> pullScopedPortfolioSnapshot() async {
    return buildPortfolioSnapshotFromMap(
      await _loadCompositeData(),
      _fallback,
      scopeClientId: _scopeForBuild(),
    );
  }

  String _token() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return List.generate(32, (_) => chars[_random.nextInt(chars.length)]).join();
  }

  Future<Map<String, dynamic>?> _snapshotDoc() async {
    if (!appSettings.firebase.isConfigured) return null;
    _snapshotInFlight ??= _db
        .collection('appSnapshots')
        .doc('adminPrototype')
        .get()
        .then((d) => d.data())
        .whenComplete(() => _snapshotInFlight = null);
    return _snapshotInFlight!;
  }

  Future<Map<String, dynamic>?> _snapshotFromCollections() async {
    if (!appSettings.firebase.isConfigured) return null;
    final data = <String, dynamic>{};
    var hasAnyRows = false;
    for (final key in _collectionKeys) {
      final qs = await _db.collection(key).get();
      final rows = qs.docs.map((d) {
        final m = Map<String, dynamic>.from(d.data());
        m['id'] = d.id;
        return m;
      }).toList();
      if (rows.isNotEmpty) hasAnyRows = true;
      data[key] = rows;
    }
    if (!hasAnyRows) return null;
    data['updatedAt'] = DateTime.now().toIso8601String();
    return data;
  }

  Future<Map<String, dynamic>?> _loadCompositeData() async {
    return await _snapshotFromCollections() ?? await _snapshotDoc();
  }

  Future<PortfolioSnapshot> _materializedPortfolio() async {
    _portfolioInFlight ??= buildPortfolioSnapshotFromMap(
      await _loadCompositeData(),
      _fallback,
      scopeClientId: _scopeForBuild(),
    ).whenComplete(() => _portfolioInFlight = null);
    return _portfolioInFlight!;
  }

  @override
  Future<List<Company>> companies() async => (await _materializedPortfolio()).companies;

  @override
  Future<List<Invoice>> invoices() async => (await _materializedPortfolio()).invoices;

  @override
  Future<List<Property>> properties() async => (await _materializedPortfolio()).properties;

  @override
  Future<List<PortfolioDocument>> documents() async => (await _materializedPortfolio()).documents;

  @override
  Future<List<PortfolioFile>> portfolioFiles() async => (await _materializedPortfolio()).files;

  @override
  Future<List<FinanceRecord>> financeRecords() async =>
      (await _materializedPortfolio()).financeRecords;

  @override
  Future<List<IncomeRow>> incomeRows() async => (await _materializedPortfolio()).incomeRows;

  @override
  Future<List<InsuranceRecord>> insuranceRecords() async =>
      (await _materializedPortfolio()).insuranceRecords;

  @override
  Future<List<ConstructionProject>> constructionProjects() async =>
      (await _materializedPortfolio()).constructionProjects;

  @override
  Future<List<ConstructionStage>> constructionStages() async =>
      (await _materializedPortfolio()).constructionStages;

  @override
  Future<String> createAccountantShareLink({
    required String scopeType,
    required String scopeId,
    required DateTime expiresAt,
  }) async {
    if (!appSettings.firebase.isConfigured) {
      return _fallback.createAccountantShareLink(
        scopeType: scopeType,
        scopeId: scopeId,
        expiresAt: expiresAt,
      );
    }

    final token = _token();
    await _db.collection('accountantLinks').doc('al-$token').set({
      'id': 'al-$token',
      'scopeType': scopeType,
      'scopeId': scopeId,
      'token': token,
      'expiresAt': expiresAt.toIso8601String(),
      'isRevoked': false,
    }, SetOptions(merge: true));

    // Keep legacy snapshot data as backup for compatibility.
    final snapshotRef = _db.collection('appSnapshots').doc('adminPrototype');
    final snapshot = await snapshotRef.get();
    final data = snapshot.data() ?? <String, dynamic>{};
    final links = List<Map<String, dynamic>>.from(
      (data['accountantLinks'] as List<dynamic>? ?? []).whereType<Map<String, dynamic>>(),
    );
    links.insert(0, {
      'id': 'al-$token',
      'scopeType': scopeType,
      'scopeId': scopeId,
      'token': token,
      'expiresAt': expiresAt.toIso8601String(),
      'isRevoked': false,
    });
    await snapshotRef.set({
      ...data,
      'accountantLinks': links,
      'updatedAt': DateTime.now().toIso8601String(),
    }, SetOptions(merge: true));

    final base = appSettings.accountantPortalBaseUrl;
    return '$base/?portal=accountant&token=$token';
  }

  @override
  Future<ClientLoginAccess> checkClientLoginAccess(String loginCode) =>
      verifyClientLoginCode(loginCode);

  @override
  Future<String?> deleteClientAccount(String? clientId) =>
      deleteClientAccountRecord(clientId ?? '');

  @override
  Future<bool> updateInvoiceStatus(String invoiceId, {required bool paid}) async {
    if (!appSettings.firebase.isConfigured) return false;
    final clientScope = _portfolioClientId;
    if (clientScope == null ||
        clientScope.isEmpty ||
        clientScope == _kScopeLoggedOut) {
      return false;
    }

    final invRef = _db.collection('invoices').doc(invoiceId);
    final invSnap = await invRef.get();
    if (!invSnap.exists) return false;
    final invData = invSnap.data() ?? <String, dynamic>{};
    final propertyId = (invData['propertyId'] ?? '').toString();
    if (propertyId.isEmpty) return false;

    final propertySnap = await _db.collection('properties').doc(propertyId).get();
    final propertyData = propertySnap.data() ?? <String, dynamic>{};
    if ((propertyData['clientId'] ?? '').toString() != clientScope) return false;

    await invRef.set({'status': paid ? 'paid' : 'unpaid'}, SetOptions(merge: true));
    return true;
  }
}

String _normalizeStatus(String value) {
  switch (value) {
    case 'in_construction':
      return 'In Construction';
    case 'fully_tenanted':
      return 'Fully Tenanted';
    case 'partially_tenanted':
      return 'Partially Tenanted';
    case 'vacant':
      return 'Vacant';
    default:
      return value.isEmpty ? 'In Construction' : value;
  }
}

String _normalizeDocType(String tag) {
  if (tag.isEmpty) return 'General';
  return tag[0].toUpperCase() + tag.substring(1).toLowerCase();
}

AppRepository buildRepo() =>
    appSettings.useLiveFirestore ? FirebaseRepository() : MockRepository();
