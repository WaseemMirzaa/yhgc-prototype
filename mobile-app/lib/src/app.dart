import 'package:flutter/foundation.dart' show defaultTargetPlatform, TargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:yhgc_mobile_app/src/config/app_settings.dart';
import 'package:yhgc_mobile_app/src/i18n/app_translations.dart';
import 'package:yhgc_mobile_app/src/i18n/formatters.dart';
import 'package:yhgc_mobile_app/src/i18n/locale_controller.dart';
import 'package:yhgc_mobile_app/src/controllers/app_controller.dart';
import 'package:yhgc_mobile_app/src/controllers/auth_controller.dart';
import 'package:yhgc_mobile_app/src/controllers/mobile_config_controller.dart';
import 'package:yhgc_mobile_app/src/data/models.dart';
import 'package:yhgc_mobile_app/src/data/repository.dart';
import 'package:yhgc_mobile_app/src/loan_type_label.dart';
import 'package:yhgc_mobile_app/src/theme/app_theme.dart';
import 'package:yhgc_mobile_app/src/services/fcm_service.dart';
import 'package:yhgc_mobile_app/src/widgets/portfolio_file_opener.dart';
import 'package:webview_flutter/webview_flutter.dart';

String _loanAmountPcmLine(FinanceRecord f, String Function(num) money) {
  final a = f.loanAmount;
  final m = f.monthlyPayment;
  if (a != null && m != null) return '${money(a)} (${money(m)} pcm)';
  if (a != null) return money(a);
  if (m != null) return '${money(m)} pcm';
  return '—';
}

bool _isMortgageFinanceType(String? raw) {
  final t = (raw ?? '').toLowerCase();
  return t == 'mortgage';
}

FinanceRecord? _primaryMortgageLoan(List<FinanceRecord> finances) {
  for (final f in finances) {
    if (_isMortgageFinanceType(f.financeType)) return f;
  }
  return null;
}

bool _portfolioFileMatchesDocKind(PortfolioFile f, String selectedDocType) {
  if (selectedDocType == 'All') return true;
  final key = selectedDocType.toLowerCase();
  switch (key) {
    case 'finance':
      return f.ownerType == 'finance_record';
    case 'insurance':
      return f.ownerType == 'insurance_record';
    case 'general':
      return f.ownerType == 'property';
    case 'construction':
      return f.ownerType == 'construction_stage' || f.tag.toLowerCase() == 'construction';
    case 'invoice':
    case 'invoices':
      return f.ownerType == 'invoice';
    default:
      return f.tag.toLowerCase() == key;
  }
}

Future<void> openInvoiceAttachments(BuildContext context, Invoice i) async {
  final urls = i.fileUrls.isNotEmpty
      ? i.fileUrls
      : (i.documentUrl.isNotEmpty ? <String>[i.documentUrl] : <String>[]);
  if (urls.isEmpty) {
    Get.snackbar('No file', 'No attachment is linked to this invoice yet.');
    return;
  }
  if (!context.mounted) return;
  if (urls.length == 1) {
    await openPortfolioFile(
      context,
      url: urls.first,
      title: '${i.supplier} (${i.ref})',
      fileName: 'invoice',
    );
    return;
  }
  await showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: Text('${i.supplier} · ${i.ref}', style: Theme.of(ctx).textTheme.titleMedium),
          ),
          for (var idx = 0; idx < urls.length; idx++)
            ListTile(
              leading: const Icon(Icons.attach_file_outlined),
              title: Text('Attachment ${idx + 1}'),
              onTap: () async {
                Navigator.pop(ctx);
                if (context.mounted) {
                  await openPortfolioFile(
                    context,
                    url: urls[idx],
                    title: '${i.supplier} (${i.ref})',
                    fileName: 'attachment-${idx + 1}',
                  );
                }
              },
            ),
        ],
      ),
    ),
  );
}

Future<void> openPortfolioFilesMenu(BuildContext context, List<PortfolioFile> files) async {
  if (files.isEmpty) {
    Get.snackbar('No files', 'Nothing to open here yet.');
    return;
  }
  if (!context.mounted) return;
  if (files.length == 1) {
    await openPortfolioFileModel(context, files.first);
    return;
  }
  await showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: Text('Choose a file'),
          ),
          for (final f in files)
            ListTile(
              leading: Icon(iconForPortfolioFile(f)),
              title: Text(f.fileName),
              subtitle: f.tag.isNotEmpty ? Text(f.tag) : null,
              onTap: () async {
                Navigator.pop(ctx);
                if (context.mounted) await openPortfolioFileModel(context, f);
              },
            ),
        ],
      ),
    ),
  );
}

/// Same artwork as `admin-web/public/yhgc-logo.png`.
class YhgcBrandLogo extends StatelessWidget {
  const YhgcBrandLogo({super.key, this.height = 40, this.fit = BoxFit.contain});

  final double height;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/images/yhgc_logo.png',
      height: height,
      fit: fit,
      filterQuality: FilterQuality.high,
      semanticLabel: 'YOUR HOME GROUP Consultancy',
    );
  }
}

Widget yhgcAppBarTitle(String title, {double logoHeight = 26}) {
  return Row(
    crossAxisAlignment: CrossAxisAlignment.center,
    children: [
      YhgcBrandLogo(height: logoHeight),
      const SizedBox(width: 10),
      Expanded(
        child: Text(
          title,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
        ),
      ),
    ],
  );
}

class YhgcApp extends StatelessWidget {
  const YhgcApp({super.key, this.initialLocale = LocaleController.en});

  final Locale initialLocale;

  @override
  Widget build(BuildContext context) {
    final repository = buildRepo();
    Get.put<AppRepository>(repository, permanent: true);
    Get.put(LocaleController()..locale.value = initialLocale, permanent: true);
    Get.put(MobileConfigController());
    Get.put(AuthController());
    Get.put(AppController(repository: repository));
    return GetMaterialApp(
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      translations: AppTranslations(),
      locale: initialLocale,
      fallbackLocale: LocaleController.fallback,
      home: const AppBootstrapPage(),
      builder: (context, child) => child ?? const SizedBox.shrink(),
    );
  }
}

/// Full-screen splash content only — no routes or buttons (customise here).
class SplashPage extends StatelessWidget {
  const SplashPage({super.key});

  @override
  Widget build(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width;
    final logoH = (w * 0.38).clamp(88.0, 152.0);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        backgroundColor: const Color(0xFF090909),
        body: DecoratedBox(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [Color(0xFF090909), Color(0xFF121212), Color(0xFF1A1513)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 20),
            child: Column(
              children: [
                const Spacer(),
                Stack(
                  alignment: Alignment.center,
                  clipBehavior: Clip.none,
                  children: [
                    IgnorePointer(
                      child: SizedBox(
                        width: logoH * 2.6,
                        height: logoH * 1.8,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            gradient: RadialGradient(
                              colors: [
                                AppColors.gold.withValues(alpha: 0.14),
                                AppColors.gold.withValues(alpha: 0.04),
                                Colors.transparent,
                              ],
                              stops: const [0.0, 0.45, 1.0],
                            ),
                          ),
                        ),
                      ),
                    ),
                    TweenAnimationBuilder<double>(
                      duration: const Duration(milliseconds: 900),
                      tween: Tween(begin: 0.0, end: 1.0),
                      curve: Curves.easeOutCubic,
                      builder: (context, v, child) => Opacity(
                        opacity: v,
                        child: Transform.scale(scale: 0.88 + 0.12 * v, child: child),
                      ),
                      child: YhgcBrandLogo(height: logoH),
                    ),
                  ],
                ),
                const SizedBox(height: 36),
                Text(
                  '"${'splash.tagline'.tr}"',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.72),
                    fontStyle: FontStyle.italic,
                    fontSize: 17,
                    height: 1.45,
                  ),
                ),
                const Spacer(),
                Text(
                  'YHG Portfolio v1.0',
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.38), fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Shown only on cold start: displays [SplashPage], then hands off to login or shell (not part of splash UI).
class AppBootstrapPage extends StatefulWidget {
  const AppBootstrapPage({super.key});

  @override
  State<AppBootstrapPage> createState() => _AppBootstrapPageState();
}

class _AppBootstrapPageState extends State<AppBootstrapPage> {
  final auth = Get.find<AuthController>();
  Worker? _sessionWorker;

  @override
  void initState() {
    super.initState();
    _sessionWorker = ever<bool>(auth.sessionReady, (_) => _goNext());
    Future.delayed(const Duration(milliseconds: 1500), _goNext);
  }

  void _goNext() {
    if (appSettings.splashPreviewOnly) return;
    if (!mounted || !auth.sessionReady.value) return;
    if (auth.loggedIn.value) {
      Get.offAll(() => const ShellPage());
      FcmService.instance.applyPendingNavigation();
    } else {
      Get.offAll(() => const LoginPage());
    }
  }

  @override
  void dispose() {
    _sessionWorker?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => const SplashPage();
}

/// Scrollable auth shell that keeps forms usable when the keyboard is open.
class _AuthScrollBody extends StatelessWidget {
  const _AuthScrollBody({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFFF8F6F2), Color(0xFFEEF1F5)],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        ),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final bottomInset = MediaQuery.viewInsetsOf(context).bottom;
          return SingleChildScrollView(
            padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + bottomInset),
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight - bottomInset),
              child: child,
            ),
          );
        },
      ),
    );
  }
}

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final code = TextEditingController();
  final pass = TextEditingController();
  final auth = Get.find<AuthController>();
  final mobileConfig = Get.find<MobileConfigController>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      mobileConfig.reloadConfig();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      resizeToAvoidBottomInset: true,
      appBar: AppBar(title: yhgcAppBarTitle('YHGC Portfolio', logoHeight: 28)),
      body: _AuthScrollBody(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
              _PanelCard(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Center(child: YhgcBrandLogo(height: MediaQuery.sizeOf(context).shortestSide * 0.18)),
                ),
              ),
              const SizedBox(height: 12),
              const _HeroStrip(
                title: 'Welcome back',
                subtitle: 'Private client access only',
                icon: Icons.verified_user_outlined,
              ),
              const SizedBox(height: 12),
              _PanelCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    TextField(
                      controller: code,
                      decoration: const InputDecoration(
                        labelText: 'LOGIN CODE',
                        hintText: 'Enter your issued code',
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(controller: pass, obscureText: true, decoration: const InputDecoration(labelText: 'PASSWORD')),
                    const SizedBox(height: 8),
                    const SizedBox(height: 16),
                    FilledButton(
                      style: FilledButton.styleFrom(backgroundColor: AppColors.crimson, minimumSize: const Size.fromHeight(48)),
                      onPressed: () async {
                        final trimmedCode = code.text.trim();
                        if (trimmedCode.isEmpty) {
                          Get.snackbar('Missing code', 'Enter your login code.');
                          return;
                        }
                        if (pass.text.isEmpty) {
                          final err = await auth.tryStartFirstLogin(trimmedCode);
                          if (err != null) {
                            Get.snackbar('Cannot continue', err);
                            return;
                          }
                          Get.to(() => const FirstLoginPage());
                          return;
                        }
                        final err = await auth.tryLogin(trimmedCode, pass.text);
                        if (err == null) {
                          Get.offAll(() => const ShellPage());
                          FcmService.instance.applyPendingNavigation();
                        } else {
                          Get.snackbar('Login failed', err);
                        }
                      },
                      child: const Text('LOG IN'),
                    ),
                    TextButton(onPressed: () => Get.to(() => const ForgotPasswordPage()), child: const Text('Forgot password?')),
                    Obx(() {
                      if (!mobileConfig.ready.value || !mobileConfig.allowMobileSignup) {
                        return const SizedBox.shrink();
                      }
                      return Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: TextButton(
                          onPressed: () => Get.to(() => const SignUpPage()),
                          child: const Text('Create a new account'),
                        ),
                      );
                    }),
                    const Divider(),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        border: Border.all(color: AppColors.gold.withValues(alpha: 0.4)),
                        borderRadius: BorderRadius.circular(14),
                        color: AppColors.surfaceAlt.withValues(alpha: 0.8),
                      ),
                      child: const Text(
                        'FIRST LOGIN\nEnter your login code and you will be prompted to create your own password.\nCode is single-use.',
                        style: TextStyle(fontSize: 12, color: Color(0xFF6B7280)),
                      ),
                    ),
                  ],
                ),
              ),
            ],
        ),
      ),
    );
  }
}

class LegalDocumentPage extends StatefulWidget {
  const LegalDocumentPage({super.key, required this.title, required this.url});

  final String title;
  final String url;

  @override
  State<LegalDocumentPage> createState() => _LegalDocumentPageState();
}

class _LegalDocumentPageState extends State<LegalDocumentPage> {
  late final WebViewController _controller;
  var _loading = true;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(onPageFinished: (_) {
          if (mounted) setState(() => _loading = false);
        }),
      )
      ..loadRequest(Uri.parse(widget.url));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (_loading)
            const Center(child: CircularProgressIndicator(color: AppColors.crimson)),
        ],
      ),
    );
  }
}

class SignUpPage extends StatefulWidget {
  const SignUpPage({super.key});

  @override
  State<SignUpPage> createState() => _SignUpPageState();
}

class _SignUpPageState extends State<SignUpPage> {
  final fullName = TextEditingController();
  final email = TextEditingController();
  final password = TextEditingController();
  final confirmPassword = TextEditingController();
  final auth = Get.find<AuthController>();
  final mobileConfig = Get.find<MobileConfigController>();
  var acceptedPrivacy = false;
  var acceptedTerms = false;
  var saving = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _guardSignupAccess());
  }

  Future<void> _guardSignupAccess() async {
    await mobileConfig.reloadConfig();
    if (!mobileConfig.allowMobileSignup && mounted) {
      Get.back();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      resizeToAvoidBottomInset: true,
      appBar: AppBar(title: yhgcAppBarTitle('Create account', logoHeight: 24)),
      body: Obx(() {
        if (!mobileConfig.ready.value) {
          return const Center(child: CircularProgressIndicator(color: AppColors.crimson));
        }
        if (!mobileConfig.allowMobileSignup) {
          return const SizedBox.shrink();
        }
        return _AuthScrollBody(
          child: Column(
              children: [
                const _HeroStrip(
                  title: 'Create your account',
                  subtitle: 'Register for private portfolio access',
                  icon: Icons.person_add_alt_1_outlined,
                ),
                const SizedBox(height: 12),
                _PanelCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      TextField(controller: fullName, decoration: const InputDecoration(labelText: 'FULL NAME')),
                      const SizedBox(height: 10),
                      TextField(
                        controller: email,
                        keyboardType: TextInputType.emailAddress,
                        decoration: const InputDecoration(labelText: 'EMAIL'),
                      ),
                      const SizedBox(height: 10),
                      TextField(controller: password, obscureText: true, decoration: const InputDecoration(labelText: 'PASSWORD')),
                      const SizedBox(height: 10),
                      TextField(
                        controller: confirmPassword,
                        obscureText: true,
                        decoration: const InputDecoration(labelText: 'CONFIRM PASSWORD'),
                      ),
                      const SizedBox(height: 12),
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        value: acceptedPrivacy,
                        onChanged: (v) => setState(() => acceptedPrivacy = v ?? false),
                        controlAffinity: ListTileControlAffinity.leading,
                        title: Wrap(
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            const Text('I accept the '),
                            GestureDetector(
                              onTap: () => Get.to(
                                () => LegalDocumentPage(
                                  title: 'Privacy Policy',
                                  url: mobileConfig.privacyUrl,
                                ),
                              ),
                              child: const Text(
                                'Privacy Policy',
                                style: TextStyle(color: AppColors.crimson, decoration: TextDecoration.underline),
                              ),
                            ),
                          ],
                        ),
                      ),
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        value: acceptedTerms,
                        onChanged: (v) => setState(() => acceptedTerms = v ?? false),
                        controlAffinity: ListTileControlAffinity.leading,
                        title: Wrap(
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            const Text('I accept the '),
                            GestureDetector(
                              onTap: () => Get.to(
                                () => LegalDocumentPage(
                                  title: 'Terms of Service',
                                  url: mobileConfig.termsUrl,
                                ),
                              ),
                              child: const Text(
                                'Terms of Service',
                                style: TextStyle(color: AppColors.crimson, decoration: TextDecoration.underline),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 8),
                      if (saving)
                        const Padding(
                          padding: EdgeInsets.only(bottom: 10),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(strokeWidth: 2.2, color: AppColors.crimson),
                              ),
                              SizedBox(width: 10),
                              Text('Creating your account...'),
                            ],
                          ),
                        ),
                      FilledButton(
                        style: FilledButton.styleFrom(backgroundColor: AppColors.crimson, minimumSize: const Size.fromHeight(48)),
                        onPressed: saving
                            ? null
                            : () async {
                                setState(() => saving = true);
                                final err = await auth.tryCreateAccount(
                                  fullName: fullName.text,
                                  email: email.text,
                                  password: password.text,
                                  confirmPassword: confirmPassword.text,
                                  acceptedPrivacy: acceptedPrivacy,
                                  acceptedTerms: acceptedTerms,
                                );
                                if (err == null) {
                                  final app = Get.find<AppController>();
                                  if (app.repository.portfolioSnapshotStream != null) {
                                    await app.refreshFirebasePortfolio();
                                  } else {
                                    await app.load();
                                  }
                                  Get.offAll(() => const ShellPage());
                                  FcmService.instance.applyPendingNavigation();
                                } else {
                                  Get.snackbar('Cannot create account', err);
                                }
                                if (mounted) setState(() => saving = false);
                              },
                        child: const Text('CREATE ACCOUNT'),
                      ),
                    ],
                  ),
                ),
              ],
          ),
        );
      }),
    );
  }
}

class FirstLoginPage extends StatefulWidget {
  const FirstLoginPage({super.key});
  @override
  State<FirstLoginPage> createState() => _FirstLoginPageState();
}

class ForgotPasswordPage extends StatefulWidget {
  const ForgotPasswordPage({super.key});

  @override
  State<ForgotPasswordPage> createState() => _ForgotPasswordPageState();
}

class _ForgotPasswordPageState extends State<ForgotPasswordPage> {
  final loginCode = TextEditingController();
  final email = TextEditingController();
  final password = TextEditingController();
  final confirmPassword = TextEditingController();
  final auth = Get.find<AuthController>();
  var saving = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      resizeToAvoidBottomInset: true,
      appBar: AppBar(title: yhgcAppBarTitle('Forgot Password')),
      body: _AuthScrollBody(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _HeroStrip(
              title: 'Password reset',
              subtitle: 'Verify your login code and email, then choose a new password',
              icon: Icons.lock_reset_rounded,
            ),
            const SizedBox(height: 12),
            _PanelCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: loginCode,
                    decoration: const InputDecoration(
                      labelText: 'LOGIN CODE',
                      hintText: 'Your issued client code',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: email,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(labelText: 'REGISTERED EMAIL'),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: password,
                    obscureText: true,
                    decoration: const InputDecoration(labelText: 'NEW PASSWORD'),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: confirmPassword,
                    obscureText: true,
                    decoration: const InputDecoration(labelText: 'CONFIRM NEW PASSWORD'),
                  ),
                  const SizedBox(height: 12),
                  if (saving)
                    const Padding(
                      padding: EdgeInsets.only(bottom: 10),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2.2, color: AppColors.crimson),
                          ),
                          SizedBox(width: 10),
                          Text('Updating your password...'),
                        ],
                      ),
                    ),
                  FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.crimson,
                      minimumSize: const Size.fromHeight(48),
                    ),
                    onPressed: saving
                        ? null
                        : () async {
                            setState(() => saving = true);
                            final err = await auth.tryResetPassword(
                              loginCode: loginCode.text,
                              email: email.text,
                              password: password.text,
                              confirmPassword: confirmPassword.text,
                            );
                            if (err == null) {
                              Get.snackbar(
                                'Password updated',
                                'You can now log in with your new password.',
                              );
                              Get.back();
                            } else {
                              Get.snackbar('Cannot reset password', err);
                            }
                            if (mounted) setState(() => saving = false);
                          },
                    child: const Text('RESET PASSWORD'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FirstLoginPageState extends State<FirstLoginPage> {
  final controller = TextEditingController();
  final auth = Get.find<AuthController>();
  bool saving = false;
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      resizeToAvoidBottomInset: true,
      appBar: AppBar(title: yhgcAppBarTitle('First Login')),
      body: _AuthScrollBody(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
              const _HeroStrip(
                title: 'Set your password',
                subtitle: 'Secure your private portfolio access',
                icon: Icons.lock_outline_rounded,
              ),
              const SizedBox(height: 12),
              _PanelCard(
                child: Column(
                  children: [
                    TextField(controller: controller, obscureText: true, decoration: const InputDecoration(labelText: 'New password')),
                    const SizedBox(height: 12),
                    if (saving)
                      const Padding(
                        padding: EdgeInsets.only(bottom: 10),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2.2, color: AppColors.crimson),
                            ),
                            SizedBox(width: 10),
                            Text('Setting up your session...'),
                          ],
                        ),
                      ),
                    FilledButton(
                      onPressed: saving
                          ? null
                          : () async {
                              setState(() => saving = true);
                        final err = await auth.trySetPassword(controller.text.trim());
                        if (err == null) {
                          final app = Get.find<AppController>();
                          if (app.repository.portfolioSnapshotStream != null) {
                            await app.refreshFirebasePortfolio();
                          } else {
                            await app.load();
                          }
                          Get.offAll(() => const ShellPage());
                          FcmService.instance.applyPendingNavigation();
                        } else {
                          Get.snackbar('Invalid', err);
                        }
                              if (mounted) setState(() => saving = false);
                            },
                      child: const Text('Save'),
                    ),
                  ],
                ),
              ),
            ],
        ),
      ),
    );
  }
}

class ShellPage extends StatelessWidget {
  const ShellPage({super.key});
  @override
  Widget build(BuildContext context) {
    final app = Get.find<AppController>();
    final pages = const [DashboardPage(), DocumentsPage(), InvoicesPage(), AlertsPage(), AccountPage()];
    return Obx(
      () => Scaffold(
        body: AnimatedSwitcher(
          duration: const Duration(milliseconds: 280),
          child: app.loading.value
              ? Center(
                  key: const ValueKey('shell-loading'),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const CircularProgressIndicator(color: AppColors.crimson),
                      const SizedBox(height: 12),
                      Text('dashboard.loading'.tr),
                    ],
                  ),
                )
              : KeyedSubtree(
                  key: ValueKey(app.tab.value),
                  child: pages[app.tab.value],
                ),
        ),
        bottomNavigationBar: SafeArea(
          minimum: const EdgeInsets.fromLTRB(12, 0, 12, 10),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(18),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x22000000),
                  blurRadius: 14,
                  offset: Offset(0, 6),
                ),
              ],
            ),
            child: NavigationBar(
              selectedIndex: app.tab.value,
              onDestinationSelected: (i) => app.tab.value = i,
              backgroundColor: Colors.transparent,
              indicatorColor: AppColors.crimson.withValues(alpha: 0.3),
              destinations: [
                NavigationDestination(icon: const Icon(Icons.home_rounded), label: 'nav.home'.tr),
                NavigationDestination(
                  icon: const Icon(Icons.folder_rounded),
                  label: defaultTargetPlatform == TargetPlatform.android
                      ? 'nav.documentsShort'.tr
                      : 'nav.documents'.tr,
                ),
                NavigationDestination(icon: const Icon(Icons.receipt_long_rounded), label: 'nav.invoices'.tr),
                NavigationDestination(icon: const Icon(Icons.notifications_rounded), label: 'nav.alerts'.tr),
                NavigationDestination(icon: const Icon(Icons.person_rounded), label: 'nav.account'.tr),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class DashboardPage extends StatelessWidget {
  const DashboardPage({super.key});

  String _money(num value) => formatEuro(value);

  @override
  Widget build(BuildContext context) {
    final app = Get.find<AppController>();
    return Scaffold(
      appBar: AppBar(
        title: yhgcAppBarTitle('YHGC Portfolio', logoHeight: 28),
        actions: [
          Obx(
            () => Padding(
              padding: const EdgeInsets.only(right: 12),
              child: IconButton(
                onPressed: () {
                  app.tab.value = 3;
                  app.unread.value = 0;
                },
                icon: Badge(label: Text(app.unread.value.toString()), child: const Icon(Icons.notifications_none)),
                tooltip: 'Open alerts',
              ),
            ),
          ),
        ],
      ),
      body: Obx(
        () {
          if (app.loading.value) {
            return const Center(child: CircularProgressIndicator());
          }

          final totalPortfolioValue = app.properties.fold<double>(0, (sum, p) => sum + p.value);
          final monthlyNetIncome = app.properties.fold<double>(0, (sum, p) => sum + p.net);
          final expenditure = app.invoices.fold<double>(0, (sum, invoice) => sum + invoice.amount);
          final activeAssets = app.properties.where((p) => p.status != 'Vacant').length;
          final monthChange = appSettings.useLiveFirestore ? (monthlyNetIncome - expenditure) : null;

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF18110E), Color(0xFF251613), Color(0xFF301A17)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x2A000000),
                      blurRadius: 20,
                      offset: Offset(0, 8),
                    ),
                  ],
                ),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('TOTAL PORTFOLIO VALUE', style: TextStyle(color: Color(0xFF6B7280), fontSize: 12)),
                  const SizedBox(height: 6),
                  Text(
                    _money(totalPortfolioValue),
                    style: const TextStyle(color: AppColors.gold, fontSize: 34, fontWeight: FontWeight.w800),
                  ),
                  Text(
                    monthChange == null
                        ? 'Monthly change currently unavailable'
                        : '▲ ${monthChange >= 0 ? '+' : ''}${_money(monthChange)} this month',
                    style: TextStyle(color: monthChange == null || monthChange >= 0 ? AppColors.gold : Colors.orangeAccent),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      SizedBox(width: 150, child: _MetricMiniCard(label: 'Net Income', value: _money(monthlyNetIncome))),
                      SizedBox(width: 150, child: _MetricMiniCard(label: 'Expenditure', value: _money(expenditure))),
                      SizedBox(width: 110, child: _MetricMiniCard(label: 'Assets', value: activeAssets.toString())),
                    ],
                  ),
                ]),
              ),
              const SizedBox(height: 14),
              const _HeroStrip(
                title: 'Your Companies',
                subtitle: 'Tap a company to view portfolio',
                icon: Icons.business_center_outlined,
              ),
              const SizedBox(height: 8),
              ...app.companies.map(
                (c) => _PanelCard(
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(c.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text('Co. No. ${c.companyNo}'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Get.to(() => CompanyPage(companyId: c.id)),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class CompanyPage extends StatelessWidget {
  final String companyId;
  const CompanyPage({super.key, required this.companyId});
  @override
  Widget build(BuildContext context) {
    final app = Get.find<AppController>();
    return Obx(() {
      Company? c;
      for (final x in app.companies) {
        if (x.id == companyId) {
          c = x;
          break;
        }
      }
      if (c == null) {
        return Scaffold(
          appBar: AppBar(title: yhgcAppBarTitle('Company', logoHeight: 24)),
          body: const Center(child: Text('This company is no longer in your portfolio.')),
        );
      }
      final properties = app.properties.where((e) => e.companyId == companyId).toList();
      Color statusColor(String s) => s == 'In Construction' ? AppColors.crimson : s == 'Fully Tenanted' ? AppColors.gold : s == 'Partially Tenanted' ? Colors.orange : Colors.grey;
      return Scaffold(
        appBar: AppBar(title: yhgcAppBarTitle(c.name, logoHeight: 24)),
        body: _PageBackdrop(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const _HeroStrip(
                title: 'Company Overview',
                subtitle: 'Live portfolio structure and status',
                icon: Icons.apartment_outlined,
              ),
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(c.name, style: const TextStyle(color: AppColors.text, fontSize: 22, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 4),
                  Text(c.address, style: const TextStyle(color: Color(0xFF6B7280))),
                  const SizedBox(height: 8),
                  Text('Directors: ${c.directors}', style: const TextStyle(color: Color(0xFF6B7280))),
                  Text('Accounts due: ${c.dueDate}', style: const TextStyle(color: Color(0xFF6B7280))),
                ]),
              ),
              const SizedBox(height: 12),
              const _SectionHeader(title: 'PROPERTIES', subtitle: 'All linked assets'),
              const SizedBox(height: 8),
              ...properties.map(
                (p) => _PanelCard(
                  child: ListTile(
                    title: Text(p.displayTitle),
                    subtitle: Text('${p.address} · ${p.type}'),
                    trailing: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(color: statusColor(p.status).withValues(alpha: 0.18), borderRadius: BorderRadius.circular(20)),
                          child: Text(p.status, style: TextStyle(color: statusColor(p.status), fontSize: 11)),
                        ),
                        Text('${p.progress}%'),
                      ],
                    ),
                    onTap: () => Get.to(() => PropertyPage(property: p)),
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    });
  }
}

class PropertyPage extends StatefulWidget {
  final Property property;
  const PropertyPage({super.key, required this.property});

  @override
  State<PropertyPage> createState() => _PropertyPageState();
}

class _PropertyPageState extends State<PropertyPage> {
  String invoiceFilter = 'All';

  String _money(num value) => formatEuro(value);

  bool _isYearMatch(Invoice invoice, String year) {
    return invoice.date.contains(year) || invoice.ref.contains(year);
  }

  Future<void> _setInvoicePaid(Invoice i, {required bool paid}) async {
    if (paid) {
      final go = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Mark as paid?'),
          content: Text('Confirm you have paid ${i.supplier} (${i.ref}).'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Mark paid')),
          ],
        ),
      );
      if (go != true || !mounted) return;
    }
    final app = Get.find<AppController>();
    final err = await app.setInvoicePaidState(i.id, paid: paid);
    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    if (err != null) {
      messenger.showSnackBar(SnackBar(content: Text(err)));
    } else {
      messenger.showSnackBar(SnackBar(content: Text(paid ? 'Marked as paid' : 'Marked as unpaid')));
    }
  }

  Future<void> _shareWithAccountant(AppController app) async {
    final link = await app.createAccountantShareLink(
      scopeType: 'property',
      scopeId: widget.property.id,
      expiresAt: DateTime.now().add(const Duration(days: 14)),
    );
    await Clipboard.setData(ClipboardData(text: link));
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Accountant link created'),
        content: SelectableText(link),
        actions: [
          TextButton(
            onPressed: () async {
              final uri = Uri.tryParse(link);
              if (uri != null) {
                await launchUrl(uri, mode: LaunchMode.externalApplication);
              }
              if (context.mounted) Navigator.of(context).pop();
            },
            child: const Text('Open link'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }

  List<PortfolioFile> _filesFor(
    AppController app,
    String propertyId, {
    String? tagEquals,
    String? ownerType,
    String? ownerId,
  }) {
    return app.files.where((f) {
      if (f.propertyId != propertyId) return false;
      if (tagEquals != null && f.tag.toLowerCase() != tagEquals.toLowerCase()) return false;
      if (ownerType != null && f.ownerType != ownerType) return false;
      if (ownerId != null && f.ownerId != ownerId) return false;
      return true;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Obx(() {
    final app = Get.find<AppController>();
    Property property;
    try {
      property = app.properties.firstWhere((p) => p.id == widget.property.id);
    } catch (_) {
      property = widget.property;
    }
    final inv = app.invoices.where((e) => e.propertyId == property.id).toList();
    final docs = app.documents.where((e) => e.propertyId == property.id).toList();
    final projectIds =
        app.constructionProjects.where((p) => p.propertyId == property.id).map((p) => p.id).toSet();
    final stages = app.constructionStages.where((s) => projectIds.contains(s.projectId)).toList()
      ..sort((a, b) => a.weekNumber.compareTo(b.weekNumber));
    final finances = app.financeRecords.where((f) => f.propertyId == property.id).toList();
    final incomes = app.incomeRows.where((r) => r.propertyId == property.id).toList();
    final policies = app.insuranceRecords.where((r) => r.propertyId == property.id).toList();
    final invoiceCostSum = inv.fold<double>(0, (sum, item) => sum + item.amount);
    final financePcmSum = finances.fold<double>(0, (s, f) => s + (f.monthlyPayment ?? 0));
    final annualFinance = financePcmSum * 12;
    final costsToDateCombined = invoiceCostSum + annualFinance;
    final projectedIncome = property.net * 12;
    final netPosition = projectedIncome - costsToDateCombined;
    final financeDocs = docs.where((d) => d.type.toLowerCase() == 'finance').toList();
    final insuranceDocs = docs.where((d) => d.type.toLowerCase() == 'insurance').toList();
    final lastUpdate = docs.isNotEmpty ? docs.first.uploadedAt : (inv.isNotEmpty ? inv.first.date : '-');
    final primaryMortgage = _primaryMortgageLoan(finances);
    final otherFinances = primaryMortgage == null
        ? finances
        : finances.where((f) => f.id != primaryMortgage.id).toList();
    final generalPropertyFiles = _filesFor(app, property.id, ownerType: 'property');
    final incomeTagFiles = _filesFor(app, property.id, tagEquals: 'income');
    final propertyLevelConstructionFiles =
        _filesFor(app, property.id, ownerType: 'property', tagEquals: 'construction');
    return DefaultTabController(
      length: 6,
      child: Scaffold(
        appBar: AppBar(
          title: yhgcAppBarTitle(property.displayTitle, logoHeight: 22),
          bottom: const TabBar(isScrollable: true, tabs: [
            Tab(text: 'Overview'),
            Tab(text: 'Construction'),
            Tab(text: 'Loan'),
            Tab(text: 'Income'),
            Tab(text: 'Invoices'),
            Tab(text: 'Insurance'),
          ]),
        ),
        body: _PageBackdrop(
          child: TabBarView(children: [
          ListView(padding: const EdgeInsets.all(16), children: [
            _KV(label: 'Address', value: property.address),
            _KV(label: 'Property type', value: property.type),
            _KV(label: 'Current value', value: formatEuro(property.value)),
            _KV(label: 'Portfolio status', value: property.status),
            if (property.tenancyStatus != null && property.tenancyStatus!.isNotEmpty)
              _KV(label: 'Tenancy', value: property.tenancyStatus!),
            if (property.purchasePriceLabel != null && property.purchasePriceLabel!.isNotEmpty)
              _KV(label: 'Purchase price', value: property.purchasePriceLabel!),
            if (finances.isNotEmpty) ...[
              const SizedBox(height: 6),
              const Text('MORTGAGE', style: TextStyle(letterSpacing: 1, fontSize: 11, color: Color(0xFF6B7280))),
              const SizedBox(height: 6),
              if (primaryMortgage != null) ...[
                _KV(
                  label: 'Mortgage',
                  value: _loanAmountPcmLine(primaryMortgage, _money),
                ),
                if (otherFinances.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  const Text('OTHER BORROWING', style: TextStyle(letterSpacing: 1, fontSize: 11, color: Color(0xFF6B7280))),
                  const SizedBox(height: 6),
                  ...otherFinances.map(
                    (f) => _KV(
                      label: loanTypeDisplayLabel(f.financeType),
                      value: _loanAmountPcmLine(f, _money),
                    ),
                  ),
                ],
              ] else ...[
                ...finances.map(
                  (f) => _KV(
                    label: loanTypeDisplayLabel(f.financeType),
                    value: _loanAmountPcmLine(f, _money),
                  ),
                ),
              ],
            ],
            if (invoiceCostSum > 0 || financePcmSum > 0)
              _KV(label: 'Costs to date (incl. finance)', value: _money(costsToDateCombined))
            else if (property.costToDateLabel != null && property.costToDateLabel!.isNotEmpty)
              _KV(label: 'Costs to date', value: property.costToDateLabel!),
            if (property.insuranceRenewalDate != null && property.insuranceRenewalDate!.isNotEmpty)
              _KV(label: 'Insurance renewal', value: property.insuranceRenewalDate!),
            if (property.managingAgent != null && property.managingAgent!.isNotEmpty)
              _KV(label: 'Managing agent', value: property.managingAgent!),
            if (property.incomeToDateLabel != null && property.incomeToDateLabel!.isNotEmpty)
              _KV(label: 'Income to date', value: property.incomeToDateLabel!),
            if (property.netPositionLabel != null && property.netPositionLabel!.isNotEmpty)
              _KV(label: 'Net position', value: property.netPositionLabel!),
            _KV(label: 'Progress', value: '${property.progress}%'),
            _KV(label: 'Linked invoices', value: '${inv.length}'),
            _KV(label: 'Linked documents', value: '${docs.length}'),
            const SizedBox(height: 10),
            Container(
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFFE5E7EB))),
              padding: const EdgeInsets.all(10),
              child: Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  _MiniStatPill(value: _money(projectedIncome), label: 'projected income', color: AppColors.gold),
                  _MiniStatPill(value: _money(costsToDateCombined), label: 'costs (incl. finance)', color: Colors.orange),
                  _MiniStatPill(value: _money(netPosition), label: 'net position', color: Colors.greenAccent),
                ],
              ),
            ),
            if (generalPropertyFiles.isNotEmpty) ...[
              const SizedBox(height: 14),
              const Text('PROPERTY FILES', style: TextStyle(letterSpacing: 1, fontSize: 11, color: Color(0xFF6B7280))),
              const SizedBox(height: 6),
              ...generalPropertyFiles.map(
                (f) => Card(
                  child: ListTile(
                    leading: Icon(iconForPortfolioFile(f)),
                    title: Text(f.fileName),
                    subtitle: Text(
                      [
                        if (f.tag.isNotEmpty) f.tag,
                        if (f.createdAt != null && f.createdAt!.isNotEmpty) f.createdAt!,
                      ].join(' · '),
                    ),
                    onTap: () => openPortfolioFileModel(context, f),
                  ),
                ),
              ),
            ],
          ]),
          ListView(padding: const EdgeInsets.all(16), children: [
            const Text('OVERALL PROGRESS', style: TextStyle(letterSpacing: 1, color: Color(0xFF6B7280))),
            const SizedBox(height: 12),
            Center(
              child: Stack(alignment: Alignment.center, children: [
                SizedBox(
                  width: 160,
                  height: 160,
                  child: CircularProgressIndicator(
                    value: property.progress / 100,
                    strokeWidth: 12,
                    color: AppColors.crimson,
                    backgroundColor: Colors.white24,
                  ),
                ),
                Text('${property.progress}%', style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800)),
              ]),
            ),
            const SizedBox(height: 12),
            _KV(label: 'Last update', value: lastUpdate),
            _KV(label: 'Logged construction weeks', value: '${stages.length}'),
            const SizedBox(height: 8),
            if (propertyLevelConstructionFiles.isNotEmpty) ...[
              const Text(
                'PROPERTY-LEVEL CONSTRUCTION',
                style: TextStyle(letterSpacing: 1, fontSize: 11, color: Color(0xFF6B7280)),
              ),
              const SizedBox(height: 6),
              ...propertyLevelConstructionFiles.map(
                (f) => Card(
                  child: ListTile(
                    leading: Icon(iconForPortfolioFile(f)),
                    title: Text(f.fileName),
                    onTap: () => openPortfolioFileModel(context, f),
                  ),
                ),
              ),
              const SizedBox(height: 8),
            ],
            if (stages.isEmpty)
              const Card(child: ListTile(title: Text('No construction weeks logged yet')))
            else
              ...stages.map((s) {
                final weekFiles = _filesFor(app, property.id, ownerType: 'construction_stage', ownerId: s.id);
                return Card(
                  child: ExpansionTile(
                    title: Text('Week ${s.weekNumber}'),
                    subtitle: Text(
                      weekFiles.isEmpty
                          ? 'Logged ${s.uploadDate}'
                          : 'Logged ${s.uploadDate} · ${weekFiles.length} file(s)',
                    ),
                    children: [
                      if (weekFiles.isEmpty)
                        const ListTile(
                          enabled: false,
                          title: Text('No files uploaded for this week', style: TextStyle(color: Color(0xFF6B7280))),
                        )
                      else
                        ...weekFiles.map(
                          (f) => ListTile(
                            leading: Icon(iconForPortfolioFile(f)),
                            title: Text(f.fileName),
                            onTap: () => openPortfolioFileModel(context, f),
                          ),
                        ),
                    ],
                  ),
                );
              }),
          ]),
          ListView(padding: const EdgeInsets.all(16), children: [
            const Text(
              'Borrowing on this property (from admin). Type, facility size, and monthly payment.',
              style: TextStyle(fontSize: 12, color: Color(0xFF6B7280)),
            ),
            const SizedBox(height: 10),
            if (finances.isEmpty)
              const Text('No loans from admin yet.', style: TextStyle(color: Color(0xFF6B7280)))
            else
              ...finances.map((f) {
                final loanFiles = _filesFor(app, property.id, ownerType: 'finance_record', ownerId: f.id);
                return Card(
                  child: ExpansionTile(
                    title: Text(loanTypeDisplayLabel(f.financeType)),
                    subtitle: Text(
                      [
                        if ((f.lenderName ?? '').trim().isNotEmpty) f.lenderName!,
                        if (f.loanAmount != null) 'Facility ${_money(f.loanAmount!)}',
                        if (f.monthlyPayment != null) 'PCM ${_money(f.monthlyPayment!)}',
                      ].join(' · '),
                    ),
                    children: [
                      if (loanFiles.isEmpty)
                        const ListTile(
                          enabled: false,
                          title: Text('No facility documents linked', style: TextStyle(color: Color(0xFF6B7280))),
                        )
                      else
                        ...loanFiles.map(
                          (pf) => ListTile(
                            leading: Icon(iconForPortfolioFile(pf)),
                            title: Text(pf.fileName),
                            onTap: () => openPortfolioFileModel(context, pf),
                          ),
                        ),
                    ],
                  ),
                );
              }),
            const SizedBox(height: 12),
            if (financeDocs.isEmpty)
              const Card(child: ListTile(title: Text('No loan documents uploaded')))
            else
              ...financeDocs.map(
                (d) => Card(
                  child: ListTile(
                    leading: const Icon(Icons.description_outlined),
                    title: Text(d.name),
                    subtitle: Text('Uploaded ${d.uploadedAt}'),
                    trailing: Text(d.type),
                    onTap: () => openPortfolioFile(context, url: d.fileUrl, title: d.name, fileName: d.name),
                  ),
                ),
              ),
          ]),
          ListView(padding: const EdgeInsets.all(16), children: [
            _KV(label: 'Current monthly net', value: _money(property.net)),
            _KV(label: 'Annual income', value: _money(projectedIncome)),
            _KV(label: 'Supplier costs (invoices)', value: _money(invoiceCostSum)),
            _KV(label: 'Loan / finance (pcm)', value: _money(financePcmSum)),
            _KV(label: 'Costs to date (incl. 12 mo finance)', value: _money(costsToDateCombined)),
            const SizedBox(height: 8),
            if (incomes.isEmpty)
              const Card(child: ListTile(title: Text('No income rows from admin yet')))
            else
              ...incomes.map(
                    (r) => Card(
                      child: ListTile(
                        title: Text('Period ${r.period}'),
                        subtitle: Text('Income ${_money(r.incomeAmount)} · Costs ${_money(r.costAmount)}'),
                      ),
                    ),
                  ),
            if (incomeTagFiles.isNotEmpty) ...[
              const SizedBox(height: 14),
              const Text('INCOME FILES', style: TextStyle(letterSpacing: 1, fontSize: 11, color: Color(0xFF6B7280))),
              const SizedBox(height: 6),
              ...incomeTagFiles.map(
                (f) => Card(
                  child: ListTile(
                    leading: Icon(iconForPortfolioFile(f)),
                    title: Text(f.fileName),
                    onTap: () => openPortfolioFileModel(context, f),
                  ),
                ),
              ),
            ],
          ]),
          ListView(padding: const EdgeInsets.all(16), children: [
            _KV(label: 'Invoice count', value: '${inv.length}'),
            _KV(label: 'Total committed (invoices)', value: _money(invoiceCostSum)),
            _KV(label: 'Paid amount', value: _money(inv.where((i) => i.status == 'Paid').fold<double>(0, (s, i) => s + i.amount))),
            _KV(label: 'Pending amount', value: _money(inv.where((i) => i.status != 'Paid').fold<double>(0, (s, i) => s + i.amount))),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              children: [
                ChoiceChip(label: const Text('All'), selected: invoiceFilter == 'All', onSelected: (_) => setState(() => invoiceFilter = 'All')),
                ChoiceChip(label: const Text('Paid'), selected: invoiceFilter == 'Paid', onSelected: (_) => setState(() => invoiceFilter = 'Paid')),
                ChoiceChip(label: const Text('Unpaid'), selected: invoiceFilter == 'Unpaid', onSelected: (_) => setState(() => invoiceFilter = 'Unpaid')),
                ChoiceChip(label: const Text('2026'), selected: invoiceFilter == '2026', onSelected: (_) => setState(() => invoiceFilter = '2026')),
              ],
            ),
            const SizedBox(height: 8),
            ...inv
                .where((i) {
                  if (invoiceFilter == 'All') return true;
                  if (invoiceFilter == 'Paid') return i.status.toLowerCase() == 'paid';
                  if (invoiceFilter == 'Unpaid') return i.status.toLowerCase() != 'paid';
                  if (invoiceFilter == '2026') return _isYearMatch(i, '2026');
                  return true;
                })
                .map(
              (i) {
                final attCount =
                    i.fileUrls.isNotEmpty ? i.fileUrls.length : (i.documentUrl.isNotEmpty ? 1 : 0);
                return Card(
                child: ListTile(
                  title: Text(i.supplier),
                  subtitle: Text(
                    '${i.ref} • ${i.date}${attCount > 1 ? ' · $attCount attachments' : ''}',
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(formatEuro(i.amount)),
                          Text(
                            i.status,
                            style: TextStyle(color: i.status == 'Paid' ? AppColors.gold : Colors.orange, fontSize: 11),
                          ),
                        ],
                      ),
                      PopupMenuButton<String>(
                        icon: const Icon(Icons.more_vert, size: 22),
                        onSelected: (v) async {
                          if (v == 'open') {
                            await openInvoiceAttachments(context, i);
                          } else if (v == 'paid') {
                            await _setInvoicePaid(i, paid: true);
                          } else if (v == 'unpaid') {
                            await _setInvoicePaid(i, paid: false);
                          }
                        },
                        itemBuilder: (context) => [
                          const PopupMenuItem(value: 'open', child: Text('Open file')),
                          if (i.status.toLowerCase() != 'paid')
                            const PopupMenuItem(value: 'paid', child: Text('Mark as paid')),
                          if (i.status.toLowerCase() == 'paid')
                            const PopupMenuItem(value: 'unpaid', child: Text('Mark as unpaid')),
                        ],
                      ),
                    ],
                  ),
                  onTap: () => openInvoiceAttachments(context, i),
                ),
              );
              }),
            const SizedBox(height: 10),
            OutlinedButton(
              onPressed: () => _shareWithAccountant(app),
              child: const Text('+ INVITE ACCOUNTANT'),
            ),
          ]),
          ListView(padding: const EdgeInsets.all(16), children: [
            _KV(label: 'Policies (admin)', value: '${policies.length}'),
            _KV(label: 'Insurance documents', value: '${insuranceDocs.length}'),
            _KV(label: 'Last insurance update', value: insuranceDocs.isEmpty ? '-' : insuranceDocs.first.uploadedAt),
            if (policies.isEmpty)
              const SizedBox.shrink()
            else
              ...policies.map((p) {
                final polFiles = _filesFor(app, property.id, ownerType: 'insurance_record', ownerId: p.id);
                return Card(
                  child: ExpansionTile(
                    title: Text(p.insurerName ?? 'Policy'),
                    subtitle: Text(
                      [
                        if (p.policyNumber != null && p.policyNumber!.isNotEmpty) 'Ref ${p.policyNumber}',
                        if (p.coverStartDate != null && p.coverStartDate!.isNotEmpty) 'From ${p.coverStartDate}',
                        if (p.coverEndDate != null && p.coverEndDate!.isNotEmpty) 'To ${p.coverEndDate}',
                        if (polFiles.isNotEmpty) '${polFiles.length} file(s)',
                      ].where((e) => e.isNotEmpty).join(' · '),
                    ),
                    children: [
                      if (polFiles.isEmpty)
                        const ListTile(
                          enabled: false,
                          title: Text('No policy documents linked', style: TextStyle(color: Color(0xFF6B7280))),
                        )
                      else
                        ...polFiles.map(
                          (f) => ListTile(
                            leading: Icon(iconForPortfolioFile(f)),
                            title: Text(f.fileName),
                            onTap: () => openPortfolioFileModel(context, f),
                          ),
                        ),
                    ],
                  ),
                );
              }),
            const SizedBox(height: 8),
            if (insuranceDocs.isEmpty)
              const Card(child: ListTile(title: Text('No insurance files uploaded')))
            else
              ...insuranceDocs.map(
                (d) => Card(
                  child: ListTile(
                    leading: const Icon(Icons.description_outlined),
                    title: Text(d.name),
                    subtitle: Text('Uploaded ${d.uploadedAt}'),
                    trailing: Text(d.type),
                    onTap: () => openPortfolioFile(context, url: d.fileUrl, title: d.name, fileName: d.name),
                  ),
                ),
              ),
          ]),
        ]),
      ),
      ),
    );
    });
  }
}

class _KV extends StatelessWidget {
  final String label;
  final String value;
  const _KV({required this.label, required this.value});
  @override
  Widget build(BuildContext context) => Card(child: ListTile(title: Text(label), trailing: Text(value, style: const TextStyle(fontWeight: FontWeight.w700))));
}

class _PanelCard extends StatelessWidget {
  final Widget child;
  const _PanelCard({required this.child});

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      shadowColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(color: Color(0xFFE5E7EB)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: child,
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  final String subtitle;
  const _SectionHeader({required this.title, required this.subtitle});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, letterSpacing: 0.6, color: AppColors.text)),
        const SizedBox(height: 2),
        Text(subtitle, style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
      ],
    );
  }
}

class _HeroStrip extends StatelessWidget {
  final String title;
  final String subtitle;
  final IconData icon;
  const _HeroStrip({required this.title, required this.subtitle, required this.icon});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppColors.crimson.withValues(alpha: 0.14),
            AppColors.gold.withValues(alpha: 0.18),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.gold.withValues(alpha: 0.35)),
      ),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.gold.withValues(alpha: 0.4)),
            ),
            child: Icon(icon, color: AppColors.gold, size: 18),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(color: AppColors.text, fontWeight: FontWeight.w700, fontSize: 15)),
                Text(subtitle, style: const TextStyle(color: Color(0xFF6B7280), fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MetricMiniCard extends StatelessWidget {
  final String label;
  final String value;
  const _MetricMiniCard({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(value, style: const TextStyle(color: AppColors.black, fontWeight: FontWeight.w700)),
          Text(label, style: const TextStyle(color: Color(0xFF6B7280), fontSize: 11)),
        ],
      ),
    );
  }
}

class _MiniStatPill extends StatelessWidget {
  final String value;
  final String label;
  final Color color;
  const _MiniStatPill({required this.value, required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 160,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(value, style: TextStyle(color: color, fontWeight: FontWeight.w700)),
          Text(label, style: const TextStyle(color: Color(0xFF6B7280), fontSize: 11)),
        ],
      ),
    );
  }
}

class DocumentsPage extends StatefulWidget {
  const DocumentsPage({super.key});
  @override
  State<DocumentsPage> createState() => _DocumentsPageState();
}

class _DocumentsPageState extends State<DocumentsPage> {
  String selectedType = 'All';
  String selectedProperty = 'All';

  Property? _findPropertyById(List<Property> properties, String id) {
    for (final p in properties) {
      if (p.id == id) return p;
    }
    return null;
  }

  Property? _findPropertyByAddress(List<Property> properties, String address) {
    for (final p in properties) {
      if (p.address == address) return p;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final app = Get.find<AppController>();
    return Scaffold(
      appBar: AppBar(title: yhgcAppBarTitle('Documents')),
      body: Obx(() {
        final propertyOptions = ['All', ...app.properties.map((e) => e.address)];
        final typeOptions = [
          'All',
          ...{
            ...app.documents.map((e) => e.type),
            if (app.files.any((f) => f.ownerType == 'construction_stage' || f.tag.toLowerCase() == 'construction'))
              'Construction',
          },
        ];

        final filtered = app.documents.where((doc) {
          final prop = _findPropertyById(app.properties, doc.propertyId);
          final propName = prop?.address ?? '';
          final typeOk = selectedType == 'All' || doc.type == selectedType;
          final propOk = selectedProperty == 'All' || propName == selectedProperty;
          return typeOk && propOk;
        }).toList();

        final selectedPropertyId = selectedProperty == 'All'
            ? null
            : _findPropertyByAddress(app.properties, selectedProperty)?.id;
        final filteredFiles = app.files.where((f) {
          final propOk = selectedProperty == 'All' || f.propertyId == selectedPropertyId;
          final typeOk = _portfolioFileMatchesDocKind(f, selectedType);
          return propOk && typeOk;
        }).toList();

        return _PageBackdrop(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
            _PanelCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _HeroStrip(
                    title: 'Document Hub',
                    subtitle: 'Filter and browse all uploaded files',
                    icon: Icons.folder_copy_outlined,
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFE5E7EB))),
                          child: Text('Total ${app.documents.length}', style: const TextStyle(color: Color(0xFF6B7280))),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              'All Property Documents',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 10),
            LayoutBuilder(
              builder: (context, constraints) {
                final stacked = constraints.maxWidth < 560;
                if (stacked) {
                  return Column(
                    children: [
                      DropdownButtonFormField<String>(
                        initialValue: selectedType,
                        decoration: const InputDecoration(labelText: 'Document type'),
                        items: typeOptions.map((e) => DropdownMenuItem(value: e, child: Text(e))).toList(),
                        onChanged: (v) => setState(() => selectedType = v ?? 'All'),
                      ),
                      const SizedBox(height: 10),
                      DropdownButtonFormField<String>(
                        initialValue: selectedProperty,
                        decoration: const InputDecoration(labelText: 'Property'),
                        items: propertyOptions.map((e) => DropdownMenuItem(value: e, child: Text(e, overflow: TextOverflow.ellipsis))).toList(),
                        onChanged: (v) => setState(() => selectedProperty = v ?? 'All'),
                      ),
                    ],
                  );
                }
                return Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: selectedType,
                        decoration: const InputDecoration(labelText: 'Document type'),
                        items: typeOptions.map((e) => DropdownMenuItem(value: e, child: Text(e))).toList(),
                        onChanged: (v) => setState(() => selectedType = v ?? 'All'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: selectedProperty,
                        decoration: const InputDecoration(labelText: 'Property'),
                        items: propertyOptions.map((e) => DropdownMenuItem(value: e, child: Text(e, overflow: TextOverflow.ellipsis))).toList(),
                        onChanged: (v) => setState(() => selectedProperty = v ?? 'All'),
                      ),
                    ),
                  ],
                );
              },
            ),
            const SizedBox(height: 12),
            if (filtered.isEmpty)
              const _PanelCard(child: ListTile(title: Text('No documents found for selected filters.'))),
            ...filtered.map((doc) {
              final prop = _findPropertyById(app.properties, doc.propertyId);
              return _PanelCard(
                child: ListTile(
                  leading: const Icon(Icons.description_outlined),
                  title: Text(doc.name),
                  subtitle: Text('${doc.type} • ${prop?.address ?? '-'} • Uploaded ${doc.uploadedAt}'),
                  trailing: IconButton(
                    icon: const Icon(Icons.open_in_new_rounded),
                    onPressed: () => openPortfolioFile(context, url: doc.fileUrl, title: doc.name, fileName: doc.name),
                  ),
                  onTap: () => openPortfolioFile(context, url: doc.fileUrl, title: doc.name, fileName: doc.name),
                ),
              );
            }),
            const SizedBox(height: 20),
            const Text(
              'Linked asset files',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 10),
            if (filteredFiles.isEmpty)
              const _PanelCard(child: ListTile(title: Text('No matching linked files for selected filters.')))
            else
              ...filteredFiles.map((f) {
                final prop = _findPropertyById(app.properties, f.propertyId);
                return _PanelCard(
                  child: ListTile(
                    leading: Icon(iconForPortfolioFile(f)),
                    title: Text(f.fileName),
                    subtitle: Text(
                      '${f.ownerType}${f.tag.isNotEmpty ? ' · ${f.tag}' : ''} · ${prop?.address ?? '-'}',
                    ),
                    onTap: () => openPortfolioFileModel(context, f),
                  ),
                );
              }),
          ],
        ),
        );
      }),
    );
  }
}

class InvoicesPage extends StatefulWidget {
  const InvoicesPage({super.key});

  @override
  State<InvoicesPage> createState() => _InvoicesPageState();
}

class _InvoicesPageState extends State<InvoicesPage> {
  String invoiceFilter = 'All';

  bool _isYearMatch(Invoice invoice, String year) {
    return invoice.date.contains(year) || invoice.ref.contains(year);
  }

  Future<void> _setInvoicePaid(Invoice i, {required bool paid}) async {
    if (paid) {
      final go = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Mark as paid?'),
          content: Text('Confirm you have paid ${i.supplier} (${i.ref}).'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Mark paid')),
          ],
        ),
      );
      if (go != true || !mounted) return;
    }
    final app = Get.find<AppController>();
    final err = await app.setInvoicePaidState(i.id, paid: paid);
    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    if (err != null) {
      messenger.showSnackBar(SnackBar(content: Text(err)));
    } else {
      messenger.showSnackBar(SnackBar(content: Text(paid ? 'Marked as paid' : 'Marked as unpaid')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = Get.find<AppController>();
    return Scaffold(
      appBar: AppBar(title: yhgcAppBarTitle('Invoices')),
      body: Obx(
        () => _PageBackdrop(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _PanelCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const _HeroStrip(
                      title: 'Invoices',
                      subtitle: 'Realtime payable and paid records',
                      icon: Icons.receipt_long_outlined,
                    ),
                    const SizedBox(height: 8),
                    Text('Total value ${formatEuro(app.invoices.fold<double>(0, (s, i) => s + i.amount))}'),
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 8,
                      children: [
                        ChoiceChip(label: const Text('All'), selected: invoiceFilter == 'All', onSelected: (_) => setState(() => invoiceFilter = 'All')),
                        ChoiceChip(label: const Text('Paid'), selected: invoiceFilter == 'Paid', onSelected: (_) => setState(() => invoiceFilter = 'Paid')),
                        ChoiceChip(label: const Text('Unpaid'), selected: invoiceFilter == 'Unpaid', onSelected: (_) => setState(() => invoiceFilter = 'Unpaid')),
                        ChoiceChip(label: const Text('2026'), selected: invoiceFilter == '2026', onSelected: (_) => setState(() => invoiceFilter = '2026')),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              ...app.invoices
                  .where((i) {
                    if (invoiceFilter == 'All') return true;
                    if (invoiceFilter == 'Paid') return i.status.toLowerCase() == 'paid';
                    if (invoiceFilter == 'Unpaid') return i.status.toLowerCase() != 'paid';
                    if (invoiceFilter == '2026') return _isYearMatch(i, '2026');
                    return true;
                  })
                  .map(
                    (i) => _PanelCard(
                      child: ListTile(
                        leading: const Icon(Icons.receipt_long_outlined),
                        title: Text(i.supplier),
                        subtitle: Text(i.ref),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Text(formatEuro(i.amount)),
                                Text(
                                  i.status,
                                  style: TextStyle(
                                    color: i.status == 'Paid' ? AppColors.gold : Colors.orange,
                                    fontSize: 11,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                const Icon(Icons.picture_as_pdf_rounded, size: 16),
                              ],
                            ),
                            PopupMenuButton<String>(
                              icon: const Icon(Icons.more_vert, size: 22),
                              onSelected: (v) async {
                                if (v == 'open') {
                                  await openInvoiceAttachments(context, i);
                                } else if (v == 'paid') {
                                  await _setInvoicePaid(i, paid: true);
                                } else if (v == 'unpaid') {
                                  await _setInvoicePaid(i, paid: false);
                                }
                              },
                              itemBuilder: (context) => [
                                const PopupMenuItem(value: 'open', child: Text('Open file')),
                                if (i.status.toLowerCase() != 'paid')
                                  const PopupMenuItem(value: 'paid', child: Text('Mark as paid')),
                                if (i.status.toLowerCase() == 'paid')
                                  const PopupMenuItem(value: 'unpaid', child: Text('Mark as unpaid')),
                              ],
                            ),
                          ],
                        ),
                        onTap: () => openInvoiceAttachments(context, i),
                      ),
                    ),
                  ),
            ],
          ),
        ),
      ),
    );
  }
}

IconData _portfolioNotificationIcon(String type) {
  switch (type) {
    case 'new_invoice':
      return Icons.receipt_long_outlined;
    case 'new_document':
      return Icons.description_outlined;
    case 'construction_update':
    case 'construction_complete':
      return Icons.construction_outlined;
    case 'insurance_60':
    case 'insurance_14':
      return Icons.shield_outlined;
    case 'new_property_added':
      return Icons.home_work_outlined;
    default:
      return Icons.notifications_outlined;
  }
}

class AlertsPage extends StatelessWidget {
  const AlertsPage({super.key});
  @override
  Widget build(BuildContext context) {
    final app = Get.find<AppController>();
    return Scaffold(
      appBar: AppBar(title: yhgcAppBarTitle('Alerts')),
      body: Obx(() {
        final alerts = <({IconData icon, String title, String subtitle, VoidCallback onTap})>[];
        for (final n in app.notifications) {
          alerts.add((
            icon: _portfolioNotificationIcon(n.type),
            title: n.title,
            subtitle: [if (n.body.isNotEmpty) n.body, if (n.createdAt.isNotEmpty) n.createdAt].join('\n'),
            onTap: () {},
          ));
        }
        for (final p in app.properties.where((p) => p.progress < 100)) {
          alerts.add((
            icon: Icons.construction_outlined,
            title: 'Progress update available',
            subtitle: '${p.progress}% complete for ${p.address}',
            onTap: () => Get.to(() => PropertyPage(property: p)),
          ));
        }
        for (final i in app.invoices.where((i) => i.status != 'Paid')) {
          Property? property;
          for (final p in app.properties) {
            if (p.id == i.propertyId) {
              property = p;
              break;
            }
          }
          alerts.add((
            icon: Icons.receipt_long_outlined,
            title: 'Invoice pending',
            subtitle: '${i.supplier} • ${formatEuro(i.amount)}',
            onTap: () {
              final linkedProperty = property;
              if (linkedProperty != null) {
                Get.to(() => PropertyPage(property: linkedProperty));
                return;
              }
              Get.to(() => const InvoicesPage());
            },
          ));
        }

        if (alerts.isEmpty) {
          return const Center(child: Text('No alerts right now'));
        }

        return _PageBackdrop(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _PanelCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const _HeroStrip(
                      title: 'Alert Center',
                      subtitle: 'Important live portfolio updates',
                      icon: Icons.notifications_active_outlined,
                    ),
                    const SizedBox(height: 8),
                    Text('${alerts.length} active alerts'),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              ...alerts
                  .map(
                    (a) => _PanelCard(
                      child: ListTile(
                        leading: Icon(a.icon),
                        title: Text(a.title),
                        subtitle: Text(a.subtitle),
                        trailing: const Icon(Icons.chevron_right_rounded),
                        onTap: a.onTap,
                      ),
                    ),
                  ),
            ],
          ),
        );
      }),
    );
  }
}

class AccountPage extends StatelessWidget {
  const AccountPage({super.key});

  Future<void> _deleteAccount(
    BuildContext context,
    AuthController auth,
  ) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete account'),
        content: const Text(
          'This removes your mobile app access, clears your session, and revokes login credentials. '
          'Portfolio records managed by your adviser may remain on file. This cannot be undone.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.crimson),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete account'),
          ),
        ],
      ),
    );
    if (confirm != true) return;

    final err = await auth.deleteAccount();
    if (!context.mounted) return;
    if (err != null) {
      Get.snackbar('Delete failed', err);
      return;
    }
    Get.offAll(() => const LoginPage());
    Get.snackbar('Account deleted', 'Your app account access has been removed.');
  }

  @override
  Widget build(BuildContext context) {
    final auth = Get.find<AuthController>();
    final app = Get.find<AppController>();
    return Scaffold(
      appBar: AppBar(title: yhgcAppBarTitle('account.title'.tr)),
      body: Obx(
        () => _PageBackdrop(
          child: LayoutBuilder(
            builder: (context, constraints) {
              return SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                child: ConstrainedBox(
                  constraints: BoxConstraints(minHeight: constraints.maxHeight),
                  child: Column(
                    children: [
                      _HeroStrip(
                        title: 'account.title'.tr,
                        subtitle: 'account.subtitle'.tr,
                        icon: Icons.manage_accounts_outlined,
                      ),
                      const SizedBox(height: 10),
                      _PanelCard(
                        child: ListTile(
                          title: Text('account.client'.tr),
                          subtitle: Text(app.companies.isEmpty ? '-' : app.companies.first.name),
                        ),
                      ),
                      _PanelCard(
                        child: ListTile(
                          title: Text('account.loginCode'.tr),
                          subtitle: Text(
                            auth.loginCode.value.isEmpty ? '-' : auth.loginCode.value,
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              letterSpacing: 0.6,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                      _PanelCard(
                        child: ListTile(
                          title: Text('account.portfolioScope'.tr),
                          subtitle: Text('account.scope'.trParams({
                            'p': '${app.properties.length}',
                            'i': '${app.invoices.length}',
                          })),
                        ),
                      ),
                      const SizedBox(height: 24),
                      FilledButton(
                        onPressed: () async {
                          await auth.logout();
                          Get.offAll(() => const LoginPage());
                        },
                        child: Text('common.logout'.tr),
                      ),
                      const SizedBox(height: 8),
                      OutlinedButton(
                        onPressed: () => _deleteAccount(context, auth),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.crimson,
                          side: const BorderSide(color: AppColors.crimson),
                        ),
                        child: Text('account.deleteAccount'.tr),
                      ),
                      const SizedBox(height: 16),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _PageBackdrop extends StatelessWidget {
  final Widget child;
  const _PageBackdrop({required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFFF8F6F2), Color(0xFFEEF1F5), Color(0xFFE9EDF2)],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        ),
      ),
      child: child,
    );
  }
}
