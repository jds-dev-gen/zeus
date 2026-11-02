/*
 * Empacota o Zeus para macOS (Apple Silicon e Intel).
 * Uso: node package-mac.js [arm64|x64|all]
 * Resultado: out/Zeus-darwin-<arq>/Zeus.app (a assinatura ad-hoc é feita a seguir com o rcodesign).
 */
const path = require('path');
const { packager } = require('@electron/packager');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');

// assinatura ad-hoc (sem certificado da Apple): no Mac com o codesign, em Linux com o rcodesign
function adHocSign(appBundle) {
  if (process.platform === 'darwin') {
    // o Whisper (programa à parte, dentro de Resources) assina-se primeiro
    const w = path.join(appBundle, 'Contents', 'Resources', 'whisper', 'whisper-cli');
    if (fs.existsSync(w)) execFileSync('codesign', ['--force', '--sign', '-', w], { stdio: 'inherit' });
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appBundle], { stdio: 'inherit' });
    return;
  }
  const rc = [process.env.RCODESIGN, path.join(os.homedir(), '.cargo', 'bin', 'rcodesign')].find(p => p && fs.existsSync(p));
  if (!rc) { console.warn('Aviso: sem rcodesign; a app fica sem assinatura ad-hoc.'); return; }
  execFileSync(rc, ['sign', appBundle], { stdio: 'ignore' });
}

const which = process.argv[2] || 'all';
const arches = which === 'all' ? ['arm64', 'x64'] : [which];

(async () => {
  require('./build.js');
  for (const arch of arches) {
    // o Whisper desta arquitetura (compilado no GitHub; ver .github/workflows/release.yml) vai para Contents/Resources/whisper
    const whisperDir = path.join(__dirname, 'vendor', `whisper-darwin-${arch}`, 'whisper');
    const extraResource = fs.existsSync(path.join(whisperDir, 'whisper-cli')) ? [whisperDir] : [];
    if (!extraResource.length) console.warn(`Aviso: sem o Whisper para ${arch}; as Notas gravam mas não transcrevem.`);
    const [appPath] = await packager({
      extraResource,
      dir: __dirname,
      name: 'Zeus',
      executableName: 'Zeus',
      platform: 'darwin',
      arch,
      out: path.join(__dirname, 'out'),
      overwrite: true,
      asar: true,
      prune: true,
      icon: path.join(__dirname, 'assets', 'icon.icns'),
      appBundleId: 'pt.joao.zeus',
      appCategoryType: 'public.app-category.productivity',
      appCopyright: 'Zeus — browser pessoal do João',
      darwinDarkModeSupport: true,
      ignore: [/^\/out($|\/)/, /^\/vendor($|\/)/, /^\/assets\/make-icon\.py$/, /^\/package-mac\.js$/, /^\/\.git($|\/)/, /^\/\.github($|\/)/, /^\/scripts($|\/)/, /^\/README\.md$/],
      extendInfo: {
        NSCameraUsageDescription: 'Os sites que abres no Zeus (por exemplo, videochamadas) podem pedir a câmara.',
        NSMicrophoneUsageDescription: 'As Notas do Zeus usam o microfone para gravar reuniões; os sites que abres (por exemplo, WhatsApp ou videochamadas) também o podem pedir.',
        NSLocationWhenInUseUsageDescription: 'Os sites que abres no Zeus podem pedir a tua localização.',
        NSBluetoothAlwaysUsageDescription: 'Alguns sites podem pedir acesso a dispositivos Bluetooth.',
        LSApplicationCategoryType: 'public.app-category.productivity',
        CFBundleURLTypes: [],
        CFBundleDocumentTypes: []
      }
    });
    const appBundle = path.join(appPath, 'Zeus.app');
    // fusíveis de segurança: a app não pode ser usada como Node nem receber opções de depuração
    await flipFuses(appBundle, {
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: true
    });
    adHocSign(appBundle);
    console.log('Pronto:', appBundle);
  }
})().catch(e => { console.error(e); process.exit(1); });
