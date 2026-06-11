# Flow + Theme Compliance Check

## Source alignment checked
- `YHGC_App_Brief_Final (2).docx` screens: `9.1` to `9.8` (9 embedded images).
- `yhgc-website-v4 (3).html` visual language: black/crimson/gold premium style.

## Screenshot-to-screen mapping (DOCX -> implemented)
- `9.1 Splash / Home` -> `mobile-app/lib/src/features/auth/splash_page.dart`
- `9.2 Login` -> `mobile-app/lib/src/features/auth/login_page.dart`
- `9.3 Main Dashboard` -> `mobile-app/lib/src/features/home/home_page.dart`
- `9.4 Company Screen` -> `mobile-app/lib/src/features/property/company_page.dart`
- `9.5 Property Details` -> `mobile-app/lib/src/features/property/property_page.dart` (`Details` tab)
- `9.6 Construction` -> `mobile-app/lib/src/features/property/property_page.dart` (`Construction` tab)
- `9.7 Finance` -> `mobile-app/lib/src/features/property/property_page.dart` (`Finance` tab)
- `9.8 Invoices` -> `mobile-app/lib/src/features/property/property_page.dart` (`Invoices` tab)

## Theme parity with HTML
- Brand tokens used: crimson `#8B1A1A`, gold `#C9A96E`, black `#0A0A0A`.
- Mobile theme centralized in `mobile-app/lib/src/theme/app_colors.dart`.
- Admin uses same palette in `admin-web/src/index.css` (`yhgc-crimson`, `yhgc-gold`, `yhgc-black`).

## Flow parity notes
- Bottom nav matches brief: Home, Documents, Invoices, Alerts, Account.
- No self-signup; first-login password path present.
- Company -> property -> six tabs path implemented.
- Admin modules include client/company/property management, notifications, accountant links, uploads.

## Mock vs Live/Firebase parity
- Same model shape used in both modes.
- Mobile repo builder returns same data contract in mock and firebase repository implementations.
- Admin `dataService` normalizes snapshot fields in both mock/localStorage and firebase mode to avoid drift.
