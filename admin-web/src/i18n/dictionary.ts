/**
 * Admin i18n dictionaries. English only.
 * Keys are added screen by screen as the UI is localized; `t()` falls back to English,
 * then to the key itself, so partially-migrated screens never crash.
 *
 * Placeholders use `{name}` and are filled via `t(key, { name: value })`.
 */
export type Lang = "fr" | "en"

export type Dict = Record<string, string>

export const en: Dict = {
  // Common
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.retry": "Retry",
  "common.logout": "Logout",
  "common.language": "Language",

  // Login
  "login.adminPortal": "Admin portal",
  "login.privateOps": "Private Operations Portal",
  "login.heroDesc": "Professional control center for portfolio operations, client onboarding, and secure data workflows.",
  "login.secureAccess": "Secure invitation-only access",
  "login.unifiedControls": "Unified portfolio controls",
  "login.dataWorkflows": "Professional data and upload workflows",
  "login.welcome": "Welcome",
  "login.singleSignin": "Single administrator sign-in.",
  "login.administratorLogin": "Administrator login",
  "login.email": "Email",
  "login.password": "Password",
  "login.submit": "Login",
  "login.invalidCredentials": "Invalid credentials.",

  // Shell / nav
  "shell.savingChanges": "Saving changes…",
  "shell.dismiss": "Dismiss",
  "shell.admin": "Admin",
  "shell.operations": "Operations",
  "shell.logout": "Logout",
  "shell.console": "Operations Console",
  "shell.secureAdmin": "Secure portfolio administration with controlled access.",
  "shell.back": "← Back",
  "shell.propertyNotFound": "Property not found",
  "shell.details": "Details",
  "nav.dashboard": "Dashboard",
  "nav.clients": "Clients",
  "nav.companies": "Companies",
  "nav.properties": "Properties",
  "nav.notifications": "Notifications",
  "nav.accountant_links": "Accountant links",
  "nav.settings": "Settings",

  // Loading / bootstrap error
  "boot.adminTitle": "YHGC Admin",
  "boot.loadingDashboard": "Loading your dashboard",
  "boot.preparing": "Preparing clients, properties, invoices and alerts...",
  "boot.couldNotLoad": "We could not load your workspace",
  "boot.checkConnection": "Check your internet connection and Firebase settings in settings.ts, then try again.",

  // Dashboard
  "dashboard.title": "Portfolio Control Center",
  "dashboard.subtitle": "Full flow admin for clients, companies, properties, uploads, notifications, and accountant links.",
  "stat.clients": "Clients",
  "stat.companies": "Companies",
  "stat.properties": "Properties",
  "stat.invoices": "Invoices",
  "stat.notifications": "Notifications",
  "dashboard.onboardClient": "Onboard Client",
  "dashboard.onboardClientDesc": "Create client, generate code, and start setup.",
  "dashboard.updateProperty": "Update Property",
  "dashboard.updatePropertyDesc": "Open a property to edit its profile and portfolio records.",
  "dashboard.manageAlerts": "Manage Alerts",
  "dashboard.manageAlertsDesc": "Review notifications and accountant links.",
}

export const fr: Dict = {
  // Common
  "common.close": "Fermer",
  "common.cancel": "Annuler",
  "common.save": "Enregistrer",
  "common.retry": "Réessayer",
  "common.logout": "Déconnexion",
  "common.language": "Langue",

  // Login
  "login.adminPortal": "Portail admin",
  "login.privateOps": "Portail privé d’opérations",
  "login.heroDesc": "Centre de contrôle professionnel pour les opérations de portefeuille, l’intégration des clients et les flux de données sécurisés.",
  "login.secureAccess": "Accès sécurisé sur invitation",
  "login.unifiedControls": "Contrôles de portefeuille unifiés",
  "login.dataWorkflows": "Flux de données et de téléversement professionnels",
  "login.welcome": "Bienvenue",
  "login.singleSignin": "Connexion administrateur unique.",
  "login.administratorLogin": "Connexion administrateur",
  "login.email": "E-mail",
  "login.password": "Mot de passe",
  "login.submit": "Connexion",
  "login.invalidCredentials": "Identifiants invalides.",

  // Shell / nav
  "shell.savingChanges": "Enregistrement…",
  "shell.dismiss": "Fermer",
  "shell.admin": "Admin",
  "shell.operations": "Opérations",
  "shell.logout": "Déconnexion",
  "shell.console": "Console d’opérations",
  "shell.secureAdmin": "Administration sécurisée du portefeuille avec accès contrôlé.",
  "shell.back": "← Retour",
  "shell.propertyNotFound": "Bien introuvable",
  "shell.details": "Détails",
  "nav.dashboard": "Tableau de bord",
  "nav.clients": "Clients",
  "nav.companies": "Sociétés",
  "nav.properties": "Biens",
  "nav.notifications": "Notifications",
  "nav.accountant_links": "Liens comptable",
  "nav.settings": "Paramètres",

  // Loading / bootstrap error
  "boot.adminTitle": "YHGC Admin",
  "boot.loadingDashboard": "Chargement de votre tableau de bord",
  "boot.preparing": "Préparation des clients, biens, factures et alertes...",
  "boot.couldNotLoad": "Impossible de charger votre espace de travail",
  "boot.checkConnection": "Vérifiez votre connexion Internet et les paramètres Firebase dans settings.ts, puis réessayez.",

  // Dashboard
  "dashboard.title": "Centre de contrôle du portefeuille",
  "dashboard.subtitle": "Administration complète des clients, sociétés, biens, téléversements, notifications et liens comptable.",
  "stat.clients": "Clients",
  "stat.companies": "Sociétés",
  "stat.properties": "Biens",
  "stat.invoices": "Factures",
  "stat.notifications": "Notifications",
  "dashboard.onboardClient": "Intégrer un client",
  "dashboard.onboardClientDesc": "Créez le client, générez le code et démarrez la configuration.",
  "dashboard.updateProperty": "Mettre à jour un bien",
  "dashboard.updatePropertyDesc": "Ouvrez un bien pour modifier son profil et ses enregistrements.",
  "dashboard.manageAlerts": "Gérer les alertes",
  "dashboard.manageAlertsDesc": "Consultez les notifications et les liens comptable.",
}

export const dictionaries: Record<Lang, Dict> = { en, fr }
