class Company {
  final String id;
  final String name;
  final String companyNo;
  final String address;
  final String directors;
  final String dueDate;

  const Company({
    required this.id,
    required this.name,
    required this.companyNo,
    required this.address,
    required this.directors,
    required this.dueDate,
  });
}

class Property {
  final String id;
  final String companyId;
  final String title;
  final String address;
  final String type;
  final String status;
  final int progress;
  final double value;
  final double net;
  final String? purchasePriceLabel;
  final String? insuranceRenewalDate;
  final String? tenancyStatus;
  final String? managingAgent;
  final String? incomeToDateLabel;
  final String? costToDateLabel;
  final String? netPositionLabel;

  const Property({
    required this.id,
    required this.companyId,
    this.title = '',
    required this.address,
    required this.type,
    required this.status,
    required this.progress,
    required this.value,
    required this.net,
    this.purchasePriceLabel,
    this.insuranceRenewalDate,
    this.tenancyStatus,
    this.managingAgent,
    this.incomeToDateLabel,
    this.costToDateLabel,
    this.netPositionLabel,
  });

  String get displayTitle => title.trim().isNotEmpty ? title.trim() : address;
}

class Invoice {
  final String id;
  final String propertyId;
  final String supplier;
  final String ref;
  final String date;
  final double amount;
  final String status;
  /// Primary link (PDF URL field or first linked asset).
  final String documentUrl;
  /// All linked file URLs from `assets` with `ownerType: invoice` for this row.
  final List<String> fileUrls;

  const Invoice({
    required this.id,
    required this.propertyId,
    required this.supplier,
    required this.ref,
    required this.date,
    required this.amount,
    required this.status,
    required this.documentUrl,
    this.fileUrls = const [],
  });
}

/// Normalised row from admin `assets` with resolved `propertyId` for client filtering.
class PortfolioFile {
  final String id;
  final String propertyId;
  final String ownerType;
  final String ownerId;
  final String tag;
  final String fileName;
  final String mimeType;
  final String urlOrPath;
  final String? createdAt;

  const PortfolioFile({
    required this.id,
    required this.propertyId,
    required this.ownerType,
    required this.ownerId,
    required this.tag,
    required this.fileName,
    required this.mimeType,
    required this.urlOrPath,
    this.createdAt,
  });
}

class PortfolioDocument {
  final String id;
  final String propertyId;
  final String name;
  final String type;
  final String uploadedAt;
  final String fileUrl;

  const PortfolioDocument({
    required this.id,
    required this.propertyId,
    required this.name,
    required this.type,
    required this.uploadedAt,
    required this.fileUrl,
  });
}

class FinanceRecord {
  final String id;
  final String propertyId;
  final String? financeType;
  final String? lenderName;
  final String? lenderContactName;
  final String? lenderContactPhone;
  final double? loanAmount;
  final double? monthlyPayment;
  final double? interestRatePct;
  final double? ltvPct;
  final String? termEndDate;

  const FinanceRecord({
    required this.id,
    required this.propertyId,
    this.financeType,
    this.lenderName,
    this.lenderContactName,
    this.lenderContactPhone,
    this.loanAmount,
    this.monthlyPayment,
    this.interestRatePct,
    this.ltvPct,
    this.termEndDate,
  });
}

class IncomeRow {
  final String id;
  final String propertyId;
  final String period;
  final double incomeAmount;
  final double costAmount;

  const IncomeRow({
    required this.id,
    required this.propertyId,
    required this.period,
    required this.incomeAmount,
    required this.costAmount,
  });
}

class InsuranceRecord {
  final String id;
  final String propertyId;
  final String? insurerName;
  final String? policyNumber;
  final String? coverStartDate;
  final String? coverEndDate;
  final String? renewal60DayAlertOn;
  final String? renewal14DayAlertOn;

  const InsuranceRecord({
    required this.id,
    required this.propertyId,
    this.insurerName,
    this.policyNumber,
    this.coverStartDate,
    this.coverEndDate,
    this.renewal60DayAlertOn,
    this.renewal14DayAlertOn,
  });
}

class ConstructionProject {
  final String id;
  final String propertyId;
  final int totalWeeks;
  final int completedStages;
  final String? startDate;
  final String? expectedCompletionDate;

  const ConstructionProject({
    required this.id,
    required this.propertyId,
    required this.totalWeeks,
    required this.completedStages,
    this.startDate,
    this.expectedCompletionDate,
  });
}

class ConstructionStage {
  final String id;
  final String projectId;
  final int weekNumber;
  final String uploadDate;

  const ConstructionStage({
    required this.id,
    required this.projectId,
    required this.weekNumber,
    required this.uploadDate,
  });
}

/// Mirrors admin `NotificationLog` in `appSnapshots.adminPrototype.notifications`.
class PortfolioNotification {
  final String id;
  final String title;
  final String body;
  final String createdAt;
  final String type;

  const PortfolioNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.createdAt,
    required this.type,
  });
}

