/// fr-FR locale formatting. Currency is the euro (the business currency) regardless
/// of the selected UI language; only the surrounding labels are translated.

const String _nbsp = ' ';

/// "1 980 000 €" — French grouping (non-breaking spaces) with the symbol after the amount.
String formatEuro(num? value) {
  if (value == null) return '—';
  final negative = value < 0;
  final digits = value.abs().round().toString();
  final buf = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buf.write(_nbsp);
    buf.write(digits[i]);
  }
  return '${negative ? '-' : ''}$buf$_nbsp€';
}

/// French numeric date "dd/MM/yyyy" from an ISO string; passes through if unparseable.
String formatDateFr(String? iso) {
  if (iso == null || iso.trim().isEmpty) return '—';
  final parsed = DateTime.tryParse(iso.trim());
  if (parsed == null) return iso;
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(parsed.day)}/${two(parsed.month)}/${parsed.year}';
}
