/// Mirrors admin-web `LOAN_TYPE_OPTIONS` and `loanTypeLabel()` in `App.tsx`.
String loanTypeDisplayLabel(String? raw) {
  const known = <String, String>{
    'mortgage': 'Mortgage',
    'bridging_loan': 'Bridging loan',
    'development_finance': 'Development finance',
    'cash_purchase': 'Cash purchase',
    'bridge': 'Bridging loan',
    'bridging': 'Bridging loan',
  };
  final v = (raw ?? '').trim();
  if (v.isEmpty) return 'Loan';
  final hit = known[v.toLowerCase()];
  if (hit != null) return hit;
  return v.replaceAll('_', ' ');
}
