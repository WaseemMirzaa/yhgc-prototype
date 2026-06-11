import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:yhgc_mobile_app/src/data/models.dart';

enum _ViewKind { image, pdf, video, other }

_ViewKind _classify(String url, String mime, String fileName) {
  final lower = url.toLowerCase();
  final m = mime.toLowerCase();
  final f = fileName.toLowerCase();
  if (m.startsWith('image/') ||
      RegExp(r'\.(png|jpe?g|gif|webp|bmp)(\?|#|$)', caseSensitive: false).hasMatch(lower) ||
      RegExp(r'\.(png|jpe?g|gif|webp|bmp)(\?|#|$)', caseSensitive: false).hasMatch(f)) {
    return _ViewKind.image;
  }
  if (m.startsWith('video/') ||
      RegExp(r'\.(mp4|webm|mov|m4v)(\?|#|$)', caseSensitive: false).hasMatch(lower) ||
      RegExp(r'\.(mp4|webm|mov|m4v)(\?|#|$)', caseSensitive: false).hasMatch(f)) {
    return _ViewKind.video;
  }
  if (m == 'application/pdf' ||
      lower.contains('.pdf') ||
      f.endsWith('.pdf')) {
    return _ViewKind.pdf;
  }
  return _ViewKind.other;
}

/// Opens images, PDFs, and videos in-app; other types show share / external browser.
Future<void> openPortfolioFile(
  BuildContext context, {
  required String url,
  required String title,
  String mimeType = '',
  String fileName = '',
}) async {
  final kind = _classify(url, mimeType, fileName.isEmpty ? title : fileName);
  final uri = Uri.tryParse(url);
  if (uri == null || !uri.hasScheme) return;

  switch (kind) {
    case _ViewKind.image:
      await Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          fullscreenDialog: true,
          builder: (ctx) => Scaffold(
            backgroundColor: Colors.black,
            appBar: AppBar(
              backgroundColor: Colors.black87,
              foregroundColor: Colors.white,
              title: Text(title, style: const TextStyle(fontSize: 16)),
            ),
            body: InteractiveViewer(
              minScale: 0.5,
              maxScale: 4,
              child: Center(
                child: Image.network(
                  url,
                  fit: BoxFit.contain,
                  loadingBuilder: (context, child, loadingProgress) {
                    if (loadingProgress == null) return child;
                    return const Padding(
                      padding: EdgeInsets.all(32),
                      child: CircularProgressIndicator(color: Colors.white70),
                    );
                  },
                  errorBuilder: (_, __, ___) => const Padding(
                    padding: EdgeInsets.all(24),
                    child: Text('Could not load image', style: TextStyle(color: Colors.white70)),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      break;
    case _ViewKind.pdf:
      final controller = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setBackgroundColor(Colors.white)
        ..loadRequest(uri);
      await Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (ctx) => Scaffold(
            appBar: AppBar(title: Text(title)),
            body: WebViewWidget(controller: controller),
          ),
        ),
      );
      break;
    case _ViewKind.video:
      await Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (ctx) => _VideoPreviewScreen(title: title, url: url),
        ),
      );
      break;
    case _ViewKind.other:
      if (!context.mounted) return;
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
                child: Text(title, style: Theme.of(ctx).textTheme.titleMedium),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text(
                  url,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280)),
                ),
              ),
              ListTile(
                leading: const Icon(Icons.open_in_browser_outlined),
                title: const Text('Open or download (browser)'),
                onTap: () async {
                  Navigator.pop(ctx);
                  await launchUrl(uri, mode: LaunchMode.externalApplication);
                },
              ),
              ListTile(
                leading: const Icon(Icons.share_outlined),
                title: const Text('Share link'),
                onTap: () async {
                  Navigator.pop(ctx);
                  await Share.share(url, subject: title);
                },
              ),
            ],
          ),
        ),
      );
      break;
  }
}

Future<void> openPortfolioFileModel(BuildContext context, PortfolioFile f) {
  return openPortfolioFile(
    context,
    url: f.urlOrPath,
    title: f.fileName,
    mimeType: f.mimeType,
    fileName: f.fileName,
  );
}

class _VideoPreviewScreen extends StatefulWidget {
  const _VideoPreviewScreen({required this.title, required this.url});

  final String title;
  final String url;

  @override
  State<_VideoPreviewScreen> createState() => _VideoPreviewScreenState();
}

class _VideoPreviewScreenState extends State<_VideoPreviewScreen> {
  late final VideoPlayerController _controller;
  bool _ready = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller = VideoPlayerController.networkUrl(Uri.parse(widget.url))
      ..initialize().then((_) {
        if (mounted) {
          setState(() {
            _ready = true;
            _error = null;
          });
          _controller.play();
        }
      }).catchError((Object e) {
        if (mounted) {
          setState(() {
            _error = e.toString();
            _ready = false;
          });
        }
      });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Center(
        child: _error != null
            ? Padding(
                padding: const EdgeInsets.all(24),
                child: Text(_error!, textAlign: TextAlign.center),
              )
            : !_ready
                ? const CircularProgressIndicator()
                : AspectRatio(
                    aspectRatio: _controller.value.aspectRatio == 0 ? 16 / 9 : _controller.value.aspectRatio,
                    child: VideoPlayer(_controller),
                  ),
      ),
    );
  }
}

IconData iconForPortfolioFile(PortfolioFile f) {
  switch (_classify(f.urlOrPath, f.mimeType, f.fileName)) {
    case _ViewKind.image:
      return Icons.image_outlined;
    case _ViewKind.pdf:
      return Icons.picture_as_pdf_outlined;
    case _ViewKind.video:
      return Icons.videocam_outlined;
    case _ViewKind.other:
      return Icons.insert_drive_file_outlined;
  }
}
