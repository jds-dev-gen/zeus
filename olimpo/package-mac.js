/*
 * Empacota o Olimpo para macOS (Apple Silicon e Intel).
 * Uso: node package-mac.js [arm64|x64|all]
 * Resultado: out/Olimpo-darwin-<arq>/Olimpo.app, com assinatura ad-hoc.
 *
 * O Claude Code (o programa que o Agent SDK usa) não vai dentro da app: o Olimpo usa o
 * Claude Code já instalado no Mac, com a sessão iniciada pelo `claude login` (subscrição).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { packager } = require('@electron/packager');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const { execFileSync } = require('child_process');

function adHocSign(appBundle) {
  if (process.platform === 'darwin') { execFileSync('codesign', ['--force', '--deep', '--sign', '-', appBundle], { stdio: 'inherit' }); return; }
  const rc = [process.env.RCODESIGN, path.join(os.homedir(), '.cargo', 'bin', 'rcodesign')].find(p => p && fs.existsSync(p));
  if (!rc) { console.warn('Aviso: sem rcodesign; a app fica sem assinatura ad-hoc.'); return; }
  execFileSync(rc, ['sign', appBundle], { stdio: 'ignore' });
}

const which = process.argv[2] || 'all';
const arches = which === 'all' ? ['arm64', 'x64'] : [which];

(async () => {
  for (const arch of arches) {
    const [appPath] = await packager({
      dir: __dirname,
      name: 'Olimpo',
      executableName: 'Olimpo',
      platform: 'darwin',
      arch,
      out: path.join(__dirname, 'out'),
      overwrite: true,
      asar: true,
      prune: true,
      icon: path.join(__dirname, 'assets', 'icon.icns'),
      appBundleId: 'pt.joao.olimpo',
      appCategoryType: 'public.app-category.productivity',
      appCopyright: 'Olimpo — interface pessoal do João',
      darwinDarkModeSupport: true,
      ignore: [
        /^\/out($|\/)/, /^\/test($|\/)/, /^\/package-mac\.js$/, /^\/README\.md$/, /^\/assets\/make-icon\.py$/, /^\/src\/main\/dev-shots\.js$/,
        // o executável do Claude Code incluído no SDK (~200 MB por sistema): usa-se o que está instalado no Mac
        /^\/node_modules\/@anthropic-ai\/claude-agent-sdk-[^/]+($|\/)/
      ],
      extendInfo: {
        NSDesktopFolderUsageDescription: 'O Olimpo mostra e arruma os ficheiros da Secretária (Entrada).',
        NSDocumentsFolderUsageDescription: 'O Olimpo procura e arruma os teus documentos.',
        NSDownloadsFolderUsageDescription: 'O Olimpo mostra os ficheiros novos das Transferências (Entrada).',
        NSRemovableVolumesUsageDescription: 'O Olimpo mostra os discos externos nos Ficheiros.',
        NSNetworkVolumesUsageDescription: 'O Olimpo mostra as pastas da rede nos Ficheiros.',
        NSAppleEventsUsageDescription: 'O Olimpo pergunta ao macOS que apps estão abertas, para as mostrar na barra e as trazer para a frente.',
        NSCameraUsageDescription: 'Os sites que abres no Zeus (por exemplo, videochamadas) podem pedir a câmara.',
        NSMicrophoneUsageDescription: 'Os sites que abres no Zeus (por exemplo, WhatsApp ou videochamadas) podem pedir o microfone.',
        LSApplicationCategoryType: 'public.app-category.productivity'
      }
    });
    const appBundle = path.join(appPath, 'Olimpo.app');
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
