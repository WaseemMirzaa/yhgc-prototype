import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class AppColors {
  static const crimson = Color(0xFF8B1A1A);
  static const gold = Color(0xFFC9A96E);
  static const black = Color(0xFF0A0A0A);
  static const offWhite = Color(0xFFF8F6F2);
  static const surface = Color(0xFFFFFFFF);
  static const surfaceAlt = Color(0xFFF5F2EC);
  static const text = Color(0xFF111827);
}

ThemeData buildTheme() {
  const scheme = ColorScheme.light(
    primary: AppColors.crimson,
    secondary: AppColors.gold,
    surface: AppColors.surface,
    onPrimary: Colors.white,
    onSecondary: AppColors.black,
    onSurface: AppColors.text,
    outline: Color(0xFFD7CFC2),
  );
  final baseText = GoogleFonts.poppinsTextTheme();
  return ThemeData(
    useMaterial3: true,
    scaffoldBackgroundColor: AppColors.offWhite,
    colorScheme: scheme,
    textTheme: baseText.copyWith(
      titleLarge: baseText.titleLarge?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.2, color: AppColors.text),
      titleMedium: baseText.titleMedium?.copyWith(fontWeight: FontWeight.w600, color: AppColors.text),
      bodyMedium: baseText.bodyMedium?.copyWith(height: 1.35, color: AppColors.text),
      bodySmall: baseText.bodySmall?.copyWith(color: const Color(0xFF6B7280)),
      labelLarge: baseText.labelLarge?.copyWith(fontWeight: FontWeight.w600, letterSpacing: 0.2),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: AppColors.surface,
      foregroundColor: AppColors.text,
      elevation: 0,
      centerTitle: false,
      scrolledUnderElevation: 0,
    ),
    cardTheme: CardThemeData(
      color: AppColors.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 2,
      margin: const EdgeInsets.symmetric(vertical: 6),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(color: Color(0xFFE5E7EB)),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: AppColors.surface,
      indicatorColor: AppColors.crimson.withValues(alpha: 0.25),
      labelTextStyle: WidgetStateProperty.all(
        const TextStyle(fontWeight: FontWeight.w600, fontSize: 12, color: AppColors.text),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(color: states.contains(WidgetState.selected) ? AppColors.crimson : const Color(0xFF6B7280)),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.crimson.withValues(alpha: 0.95),
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.text,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        side: BorderSide(color: scheme.outline.withValues(alpha: 0.8)),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: Colors.white,
      selectedColor: AppColors.crimson.withValues(alpha: 0.3),
      side: const BorderSide(color: Color(0xFFE5E7EB)),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      labelStyle: const TextStyle(color: AppColors.text),
    ),
    inputDecorationTheme: const InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(14)),
        borderSide: BorderSide(color: Color(0xFFE5E7EB)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(14)),
        borderSide: BorderSide(color: Color(0xFFE5E7EB)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(14)),
        borderSide: BorderSide(color: AppColors.gold, width: 1.3),
      ),
      labelStyle: TextStyle(color: Color(0xFF6B7280)),
      hintStyle: TextStyle(color: Color(0xFF9CA3AF)),
    ),
  );
}

