# Immersia 360 companion app

The **native capture companion** (PRD CAP-14): the booth web app in an iOS and Android shell, plus a native
recorder for **120–240 fps**, which no browser can do.

It is the same web code. The app's WebView loads the deployed booth (`server.url`), so a web deploy reaches every
companion at once, and everything except the camera still happens in the web layer: the UI, the on-device take
store, the slow-motion render, the upload and the share page. Only recording changes hands.

```
                      the companion app
        ┌──────────────────────────────────────────────┐
        │  WebView  (transparent)   the booth web app    │  ← buttons, countdown, REC, drawer
        │  ───────────────────────────────────────────  │
        │  native preview (AVFoundation / CameraX)       │  ← the picture, behind the page
        └──────────────────────────────────────────────┘
   record: native camera ─ 240 fps movie file ─ Capacitor file URL ─ take store ─ render queue (CAP-13)
```

|                                      |                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `apps/companion`                     | this app: Capacitor 8.5.3 config, the generated `android/` and `ios/` projects |
| `packages/capacitor-high-speed`      | the native plugin `@immersia/capacitor-high-speed` (Swift and Kotlin)          |
| `packages/capture/src/native-hfr.ts` | the booth's `native-hfr` camera source: choice mapping, open, recorder         |

## What the operator gets

- **Booth settings → Camera → High-speed cameras** lists the lenses that record 120 fps or more, each with its
  top rate, and a **Frame rate** switch (120 / 240) for the lens chosen. Nothing of this shows in a browser.
- The rest is as with a web camera: spin length, countdown, the tap and keyboard triggers, **motion start**, and
  the REC indicator. A take lands in the same take store and the same render queue as any other; the render uses
  every frame for slow motion (CAP-13).
- The preview is the camera's own picture. The event's **look** and **background replacement** are applied when
  the video is rendered, as for any take, not on this live preview.
- **Mirror** and the **fill light** frame work as before. The torch and zoom are not offered on the native camera.
- A take is never lost: the camera's movie is copied into the take store and only then deleted; if the app dies
  in between, the next start copies it in again (`recoverNativeTakes`).

## Build it

You need Node 22+, pnpm (`corepack enable`), and for the platforms you build:

- **Android**: JDK 21 and the Android SDK (Android Studio installs both). minSdk 24 (Android 7), target 36.
- **iOS**: macOS with Xcode 16 or later. iOS 15 or later. The project uses Swift Package Manager (Capacitor 8's
  default), so there are no pods.

The app needs to know which booth to load. Set it when you sync, as an **https** origin (a path is the page the
app opens first):

```sh
export COMPANION_SERVER_URL=https://booth.example.com/studio
pnpm install
pnpm --filter @immersia/companion run sync        # both platforms; add `android` or `ios` for one
```

`sync` writes the page shown when the booth cannot be reached (`www/`), puts the booth's host in the iOS
**WKAppBoundDomains** list (iOS runs the booth's service worker, its offline shell, only for app-bound domains)
and runs `cap sync`. Use it instead of a bare `cap sync`. Commit `Info.plist` with your host once, if you keep a fork.

| Variable                      | Meaning                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `COMPANION_SERVER_URL`        | Required. `https://…`; the origin is what is loaded, the path is where the app starts.         |
| `COMPANION_ALLOW_NAVIGATION`  | Optional. Comma-separated extra hosts the WebView may navigate to (the booth's own is always). |
| `COMPANION_ALLOW_CLEARTEXT=1` | Development only: allows `http://` to a private address (a dev server on your LAN).            |

### Android

```sh
cd apps/companion/android
./gradlew assembleDebug                 # app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

or `pnpm --filter @immersia/companion open:android` and run from Android Studio.

### iOS

```sh
pnpm --filter @immersia/companion open:ios      # opens Xcode
```

Pick your team under _Signing & Capabilities_ and run on a **device**. The simulator builds and launches the
shell, but it has no camera, so it cannot record (CI builds it unsigned:
`xcodebuild -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO`).

### Icons

The launcher icons and splash images are drawn from the PWA icon (`apps/web/src/lib/brand-icon.tsx`):
`pnpm --filter @immersia/companion icons` regenerates them (a test fails if the proportions drift).

## Sign and release

**The app id `com.immersiavr.booth360` is permanent once a store has it.** Change `APP_ID` in `src/config.ts` and
regenerate the platforms (`cap add`) before the first upload if it should be something else.

- **Android**: create an upload key (`keytool -genkeypair -v -storetype PKCS12 -keystore immersia.jks -alias immersia
-keyalg RSA -keysize 2048 -validity 10000`), keep it out of git (`*.jks` is ignored), add a `signingConfigs` block to
  `android/app/build.gradle` that reads it from `keystore.properties`, then `./gradlew bundleRelease` (Play) or
  `assembleRelease` (an APK to sideload).
- **iOS**: set the team and a unique bundle id in Xcode, then _Product → Archive → Distribute App_.

### How operators install it

The companion is for the people running booths, not for guests, so it is not a public store listing.

| Where           | How                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Android         | Send the APK (or host it) and install it ("Install unknown apps" allowed for the browser or file manager), or publish it as a private app in **Managed Google Play** or an **internal testing** track. |
| iPhone and iPad | **TestFlight** (invite the operators; builds last 90 days), **Ad Hoc** (devices registered in your developer account), or a **custom app** through Apple Business Manager.                             |

Two honest cautions. Capacitor documents `server.url` as meant for live-reload development, not production; here
it is the point of the app (one deploy, same code), and it works, but you own the consequences: the app is only as
available as the booth's server, and the offline shell depends on the service worker (see _Offline_ below). And a
wrapper whose only job is to show a website can be refused by **App Store review** (guideline 4.2); the native
high-speed recorder is real functionality, but plan on TestFlight, Ad Hoc or a custom app rather than a public
listing.

### Offline

The booth is a PWA: after the first load its service worker keeps the shell, so the booth starts without a
network. Android's WebView runs service workers for any https origin. A WKWebView on iOS runs them only for
**app-bound domains**, so the sync lists the booth's host in `WKAppBoundDomains` and the config turns on
`limitsNavigationsToAppBoundDomains` (this follows Capacitor's and Apple's documentation, and has not been
verified on a device yet). If the booth cannot be reached at all (first launch, no network), the app shows
`www/offline.html` with a **Try again** button. Takes already recorded are on the device and are not affected.

### Known gap: signing in

The booth page needs a signed-in operator, and the app signs in inside its WebView. Two things get in the way:

- **Google sign-in does not work in an embedded WebView**: Google refuses it (`disallowed_useragent`).
- A **magic link** is an https link in an email, so it opens in the phone's browser, where it signs in the
  _browser_, not the app.

Neither is solved by the app today, and it needs a change on the web side. The options, best first: a **code-based
sign-in** (the email carries a 6-digit code to type into the app); a **device pairing code** shown in the console and
typed into the app; or **App Links / Universal Links** so the email link opens the app (the server must publish
`/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association`, and the app needs the matching
intent filter and associated-domains entitlement). Until one of them exists, an operator cannot get a session into
the app by themselves. This was found while building CAP-14 and is the first thing to settle before a pilot.

## Which phones record 240 fps?

_A help-centre style note._

**What you need:** a phone or tablet whose **back camera records at least 120 fps** to a file, and storage. The
app shows what yours can do: open **Booth settings → Camera**. If a **High-speed cameras** group is listed, each
lens in it shows its top rate ("up to 240 fps"). If it is not there, the device offers no high-speed mode to this
app, and the booth uses a normal camera (60 fps at best in a browser).

| Device                          | What to expect                                                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| iPhone 8 and later (iOS 15+)    | 1080p at **240** fps (and 120) on the back camera. Some newer Pro models also do 4K at 120 fps.                                                                                                                                      |
| iPhone 6, 6s and 7              | 1080p at 120 fps and 720p at 240 fps.                                                                                                                                                                                                |
| iPad                            | Recent models record 120 fps or more; the settings list is the answer for yours.                                                                                                                                                     |
| Android (Pixel, Galaxy, others) | **Only where the maker's camera driver offers high-speed video to apps.** Typically 120 and/or 240 fps at 720p or 1080p when it does; many phones, mid-range ones above all, do not. We have not yet tested specific Android models. |

On Android the high-speed mode comes from the camera driver (Camera2 _constrained high-speed video_, which CameraX
1.6 uses). A phone can record 240 fps in its own camera app and still not offer it to other apps, so treat the table
as a starting point and **test the exact model before an event**.

**Good to know**

- 240 fps is real: at 8 s a take is about 1,900 frames. A 1080p 240 fps take is on the order of **100 MB**,
  copied into the app's storage when it ends (an operator sees "Saving…" for a few seconds). Keep several GB free;
  the app refuses to record under 500 MB.
- Light matters: at 1/240 s each frame gets a quarter of the light of 60 fps. Light the platform well.
- Phones get warm recording at high speed for hours. The app tells you when the system reports heat and keeps the
  take recorded so far if the camera stops. Keep the phone out of the sun and, for long events, on a stand with air.
- A phone call or switching apps pauses the camera; the take in progress is kept as far as it got.
- The **motion start** reads the picture the guest sees, on iOS and Android, about ten times a second while the
  booth waits for a spin. If a device cannot, the switch says so and the tap and keyboard starts still work.

## Troubleshooting

| You see                                                       | Why, and what to do                                                                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| "The camera or microphone was refused"                        | The OS permission was denied. Open the app's settings on the device, allow Camera and Microphone.                     |
| "This camera has no high-speed mode at the chosen frame rate" | Pick another lens or a lower rate in Booth settings.                                                                  |
| "…can't record sound"                                         | This phone's high-speed recorder carries no audio. Turn the microphone off in the event setup.                        |
| "This device is almost out of storage"                        | Free space; the app records only with more than 500 MB free.                                                          |
| A black screen where the picture should be                    | Close the booth's settings and restart the booth; if it persists, the page's background is opaque (a bug: report it). |
| The app opens `offline.html`                                  | The booth server could not be reached. Check the network and tap _Try again_.                                         |

## Verifying a build on a device

CI compiles the Swift and Kotlin and the web side has unit tests with the plugin mocked, but **only a device
proves the camera**. Before an event, on each model you will use:

1. Install, allow Camera and Microphone, sign in, open an event's booth, **Start**.
2. Booth settings → Camera: the high-speed lenses and their rates are listed; the picture is behind the UI.
3. Record a 240 fps take. In the Render queue it appears as "Ready to render", and in the Takes list its length is
   the spin length. The rendered video is in slow motion.
4. Rotate the device: the picture stays upright, and so does a take.
5. Turn motion start on, spin the platform: the take starts. Turn the screen off and on, take a call, switch apps:
   the camera comes back.
6. Force-quit the app during a take, reopen the booth: the take is back in the queue ("Recovered 1 take").

## Development notes

- The plugin's JavaScript API is `packages/capacitor-high-speed/src/definitions.ts`; the iOS side is
  `AVCaptureSession` with the highest `maxFrameRate` format of the chosen lens (locked for configuration, frame
  duration pinned) and `AVCaptureMovieFileOutput`; the Android side is CameraX 1.6.2's `HighSpeedVideoSessionConfig`
  with a `Recorder`. Both draw the preview in a view behind the transparent WebView.
- A recorded movie is read into the web layer through Capacitor's file URL (`Capacitor.convertFileSrc`), in 8 MB
  slices, never as base64. On iOS the finished file is given the extension `.hfr`: Capacitor's scheme handler
  answers `.mov` URLs without the CORS headers a cross-origin read needs.
- `server.url` must be an origin with no path or trailing slash (`src/config.ts` enforces it): iOS names exactly
  that string as the origin allowed to read a file.
- The booth's service worker leaves `/_capacitor_file_/` URLs alone (`apps/web/src/app/sw.ts`).
- Not implemented: a Camera2 constrained-high-speed fallback for devices CameraX does not cover (CameraX drives
  Camera2's high-speed session itself, so this only matters where CameraX reports no high-speed capability but
  Camera2 would); localised iOS permission texts (the booth itself is in English, Spanish and Portuguese, the
  permission prompts the OS shows are in English); signing in inside the app (see _Known gap_).
