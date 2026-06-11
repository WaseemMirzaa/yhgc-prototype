.PHONY: build-debug-apk build-release-apk build-release-ios

# Requires Flutter SDK on PATH (`flutter doctor`).
build-debug-apk:
	flutter build apk --debug

build-release-apk:
	flutter build apk --release

# iOS: no codesign (CI / local artifact); use Xcode for signed archives.
build-release-ios:
	flutter build ios --release --no-codesign
