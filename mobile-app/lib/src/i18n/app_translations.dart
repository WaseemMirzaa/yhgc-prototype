import 'package:get/get.dart';

/// GetX translations. English only.
/// Use `'key'.tr` (and `'key'.trParams({'x': ...})` for placeholders like `@x`).
///
/// Keys are added screen by screen as the UI is localized. Enum/status labels that
/// are also used for comparisons are handled at their conversion sites, not here.
class AppTranslations extends Translations {
  @override
  Map<String, Map<String, String>> get keys => {
        'en': _en,
        'fr': _fr,
      };
}

const Map<String, String> _en = {
  // Common
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.close': 'Close',
  'common.done': 'Done',
  'common.logout': 'Logout',
  'app.title': 'YHGC Portfolio',

  // Splash
  'splash.tagline': 'Your wealth, managed\nwith precision and discretion',
  'splash.version': 'YHG Portfolio v1.0',

  // Login
  'login.welcomeBack': 'Welcome back',
  'login.subtitle': 'Private client access only',
  'login.codeLabel': 'LOGIN CODE',
  'login.codeHint': 'Enter your issued code',
  'login.passwordLabel': 'PASSWORD',
  'login.submit': 'LOG IN',
  'login.forgot': 'Forgot password?',
  'login.createAccount': 'Create a new account',
  'login.firstLoginInfo':
      'FIRST LOGIN\nEnter your login code and you will be prompted to create your own password.\nCode is single-use.',
  'login.missingCode': 'Missing code',
  'login.enterCode': 'Enter your login code.',
  'login.cannotContinue': 'Cannot continue',
  'login.loginFailed': 'Login failed',

  // First login / set password
  'firstLogin.title': 'First Login',
  'firstLogin.setPassword': 'Set your password',
  'firstLogin.secure': 'Secure your private portfolio access',
  'firstLogin.newPassword': 'New password',
  'firstLogin.settingUp': 'Setting up your session...',
  'firstLogin.invalid': 'Invalid',

  // Sign up
  'signup.title': 'Create account',
  'signup.heading': 'Create your account',
  'signup.subtitle': 'Register for private portfolio access',
  'signup.fullName': 'FULL NAME',
  'signup.email': 'EMAIL',
  'signup.password': 'PASSWORD',
  'signup.confirmPassword': 'CONFIRM PASSWORD',
  'signup.acceptPrivacyPrefix': 'I accept the ',
  'signup.acceptTermsPrefix': 'I accept the ',
  'signup.creating': 'Creating your account...',
  'signup.submit': 'CREATE ACCOUNT',
  'signup.cannotCreate': 'Cannot create account',

  // Forgot password
  'forgot.title': 'Forgot Password',
  'forgot.heading': 'Password reset',
  'forgot.subtitle': 'We will send a reset link to your email',
  'forgot.emailLabel': 'Registered email',
  'forgot.send': 'Send reset link',
  'forgot.missingEmail': 'Missing email',
  'forgot.enterEmail': 'Please enter your registered email.',
  'forgot.resetSent': 'Reset sent',
  'forgot.resetSentBody': 'Reset link sent to @email',

  // Legal titles (shared)
  'privacy.title': 'Privacy Policy',
  'terms.title': 'Terms of Service',

  // Bottom navigation
  'nav.home': 'Home',
  'nav.documents': 'Documents',
  'nav.documentsShort': 'Docs',
  'nav.invoices': 'Invoices',
  'nav.alerts': 'Alerts',
  'nav.account': 'Account',

  // Dashboard
  'dashboard.openAlerts': 'Open alerts',
  'dashboard.loading': 'Loading your portfolio...',
  'dashboard.totalValue': 'TOTAL PORTFOLIO VALUE',
  'dashboard.monthlyUnavailable': 'Monthly change currently unavailable',
  'dashboard.thisMonth': '▲ @amount this month',
  'dashboard.netIncome': 'Net Income',
  'dashboard.expenditure': 'Expenditure',
  'dashboard.assets': 'Assets',
  'dashboard.yourCompanies': 'Your Companies',
  'dashboard.tapCompany': 'Tap a company to view portfolio',
  'dashboard.coNo': 'Co. No. @no',

  // Account
  'account.title': 'Account',
  'account.subtitle': 'Access mode and connected portfolio',
  'account.client': 'Client',
  'account.loginCode': 'Login code',
  'account.portfolioScope': 'Portfolio scope',
  'account.scope': '@p properties • @i invoices',
  'account.deleteAccount': 'Delete Account',
  'account.language': 'Language',
  'account.languageFrench': 'Français',
  'account.languageEnglish': 'English',
};

const Map<String, String> _fr = {
  // Common
  'common.cancel': 'Annuler',
  'common.save': 'Enregistrer',
  'common.close': 'Fermer',
  'common.done': 'Terminé',
  'common.logout': 'Déconnexion',
  'app.title': 'YHGC Portfolio',

  // Splash
  'splash.tagline': 'Votre patrimoine, géré\navec précision et discrétion',
  'splash.version': 'YHG Portfolio v1.0',

  // Login
  'login.welcomeBack': 'Bon retour',
  'login.subtitle': 'Accès réservé aux clients privés',
  'login.codeLabel': 'CODE DE CONNEXION',
  'login.codeHint': 'Saisissez le code qui vous a été remis',
  'login.passwordLabel': 'MOT DE PASSE',
  'login.submit': 'SE CONNECTER',
  'login.forgot': 'Mot de passe oublié ?',
  'login.createAccount': 'Créer un nouveau compte',
  'login.firstLoginInfo':
      'PREMIÈRE CONNEXION\nSaisissez votre code de connexion et vous serez invité à créer votre propre mot de passe.\nLe code est à usage unique.',
  'login.missingCode': 'Code manquant',
  'login.enterCode': 'Saisissez votre code de connexion.',
  'login.cannotContinue': 'Impossible de continuer',
  'login.loginFailed': 'Échec de la connexion',

  // First login / set password
  'firstLogin.title': 'Première connexion',
  'firstLogin.setPassword': 'Définissez votre mot de passe',
  'firstLogin.secure': 'Sécurisez l’accès à votre portefeuille privé',
  'firstLogin.newPassword': 'Nouveau mot de passe',
  'firstLogin.settingUp': 'Configuration de votre session...',
  'firstLogin.invalid': 'Non valide',

  // Sign up
  'signup.title': 'Créer un compte',
  'signup.heading': 'Créez votre compte',
  'signup.subtitle': 'Inscrivez-vous pour accéder à votre portefeuille privé',
  'signup.fullName': 'NOM COMPLET',
  'signup.email': 'E-MAIL',
  'signup.password': 'MOT DE PASSE',
  'signup.confirmPassword': 'CONFIRMER LE MOT DE PASSE',
  'signup.acceptPrivacyPrefix': 'J’accepte la ',
  'signup.acceptTermsPrefix': 'J’accepte les ',
  'signup.creating': 'Création de votre compte...',
  'signup.submit': 'CRÉER LE COMPTE',
  'signup.cannotCreate': 'Impossible de créer le compte',

  // Forgot password
  'forgot.title': 'Mot de passe oublié',
  'forgot.heading': 'Réinitialisation du mot de passe',
  'forgot.subtitle': 'Nous enverrons un lien de réinitialisation à votre e-mail',
  'forgot.emailLabel': 'E-mail enregistré',
  'forgot.send': 'Envoyer le lien',
  'forgot.missingEmail': 'E-mail manquant',
  'forgot.enterEmail': 'Veuillez saisir votre e-mail enregistré.',
  'forgot.resetSent': 'Lien envoyé',
  'forgot.resetSentBody': 'Lien de réinitialisation envoyé à @email',

  // Legal titles (shared)
  'privacy.title': 'Politique de confidentialité',
  'terms.title': 'Conditions d’utilisation',

  // Bottom navigation
  'nav.home': 'Accueil',
  'nav.documents': 'Documents',
  'nav.documentsShort': 'Docs',
  'nav.invoices': 'Factures',
  'nav.alerts': 'Alertes',
  'nav.account': 'Compte',

  // Dashboard
  'dashboard.openAlerts': 'Ouvrir les alertes',
  'dashboard.loading': 'Chargement de votre portefeuille...',
  'dashboard.totalValue': 'VALEUR TOTALE DU PORTEFEUILLE',
  'dashboard.monthlyUnavailable': 'Variation mensuelle indisponible pour le moment',
  'dashboard.thisMonth': '▲ @amount ce mois-ci',
  'dashboard.netIncome': 'Revenu net',
  'dashboard.expenditure': 'Dépenses',
  'dashboard.assets': 'Actifs',
  'dashboard.yourCompanies': 'Vos sociétés',
  'dashboard.tapCompany': 'Touchez une société pour voir son portefeuille',
  'dashboard.coNo': 'N° @no',

  // Account
  'account.title': 'Compte',
  'account.subtitle': 'Mode d’accès et portefeuille connecté',
  'account.client': 'Client',
  'account.loginCode': 'Code de connexion',
  'account.portfolioScope': 'Périmètre du portefeuille',
  'account.scope': '@p biens • @i factures',
  'account.deleteAccount': 'Supprimer le compte',
  'account.language': 'Langue',
  'account.languageFrench': 'Français',
  'account.languageEnglish': 'English',
};
