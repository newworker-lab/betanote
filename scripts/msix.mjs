// Lays out the packaged Windows app (release/<id>-win32-x64, from `npm run package:win`) as the contents of an MSIX
// package for the Microsoft Store: writes AppxManifest.xml into it and copies the Store logos (brand/msix) to Assets/.
// The package itself is then made with MakeAppx (Windows SDK) from that folder; the Store signs it, so it is not
// signed here. See docs/DEVELOPMENT.md, "Microsoft Store 패키지".
//   node scripts/msix.mjs            # writes the manifest and assets, prints the folder
// The identity is the one Partner Center gives the reserved app (Product identity page), kept with the app's name in
// core/app-name.json (store): these values are not secret (every package carries them). An environment variable
// stands in for one of them, to build for another listing:
//   MSIX_IDENTITY_NAME           Package/Identity/Name
//   MSIX_PUBLISHER               Package/Identity/Publisher (CN=…)
//   MSIX_PUBLISHER_DISPLAY_NAME  Package/Properties/PublisherDisplayName
//   MSIX_DISPLAY_NAME            the name reserved in the Store
import { readFile, writeFile, mkdir, cp, access } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const appName = JSON.parse(await readFile(new URL('core/app-name.json', root), 'utf8'));
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const target = new URL(`release/${appName.id}-win32-x64/`, root);
await access(new URL(`${appName.id}.exe`, target)).catch(() => { throw new Error(`Package the Windows app first (npm run package:win): ${appName.id}.exe is not in release/${appName.id}-win32-x64`); });
const xml = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const env = (name, fallback) => (process.env[name] || '').trim() || fallback;
// A Store version has four parts and the Store keeps the last for itself: 1.2.3 becomes 1.2.3.0.
const version = /^\d+\.\d+\.\d+$/.test(pkg.version) ? `${pkg.version}.0` : (() => { throw new Error(`package.json version ${pkg.version} is not three numbers`); })();
const kept = appName.store || {};
const identity = { name: env('MSIX_IDENTITY_NAME', kept.name), publisher: env('MSIX_PUBLISHER', kept.publisher), publisherName: env('MSIX_PUBLISHER_DISPLAY_NAME', kept.publisherDisplayName), displayName: env('MSIX_DISPLAY_NAME', kept.displayName) };
if (!/^[A-Za-z0-9.-]{3,50}$/.test(identity.name) || !/^CN=/.test(identity.publisher)) throw new Error('The package identity is not one Partner Center gives: check store in core/app-name.json');
const manifest = `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap rescap">
  <Identity Name="${xml(identity.name)}" Publisher="${xml(identity.publisher)}" Version="${version}" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>${xml(identity.displayName)}</DisplayName>
    <PublisherDisplayName>${xml(identity.publisherName)}</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.22621.0" />
  </Dependencies>
  <Resources>
    <Resource Language="ko-KR" />
    <Resource Language="en-US" />
  </Resources>
  <Applications>
    <Application Id="${xml(appName.product.replace(/[^A-Za-z0-9]/g, ''))}" Executable="${xml(appName.id)}.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="${xml(identity.displayName)}" Description="${xml(pkg.description)}" BackgroundColor="transparent" Square150x150Logo="Assets\\Square150x150Logo.png" Square44x44Logo="Assets\\Square44x44Logo.png">
        <uap:DefaultTile Wide310x150Logo="Assets\\Wide310x150Logo.png" />
      </uap:VisualElements>
    </Application>
  </Applications>
  <Capabilities>
    <Capability Name="internetClient" />
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
`;
await mkdir(new URL('Assets/', target), { recursive: true });
await cp(new URL('brand/msix/', root), new URL('Assets/', target), { recursive: true });
await writeFile(new URL('AppxManifest.xml', target), manifest);
console.log(`${new URL('.', target).pathname}\n${identity.name} ${version} (${identity.publisherName})`);
