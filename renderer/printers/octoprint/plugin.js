/**
 * printers/octoprint/plugin.js — OctoPrint plugin, entry point (BETA).
 *
 * Marlin 2 (and any serial-firmware printer) behind OctoPrint — usually OctoPi
 * on a Raspberry Pi wired to the printer. Self-contained: its connection core,
 * cards, control, camera, discovery, add flow (with Application Keys), styles,
 * model catalogue, strings and main-process side all live in this folder; it
 * imports host services only. Contract: docs/PRINTER-PLUGINS.md.
 * Protocol: ./PROTOCOL.md.
 */
import { ctx } from '../context.js';
import { registerPrinterPlugin } from '../plugins.js';
import { schemaWidget } from '../modal-helpers.js';
import { betaBadgeHtml } from '../beta-badge.js';
import {
  BRAND, opKey, opGetConn, opIsOnline, opPing, opConnect, opDisconnect, opDisconnectAll,
  opJobControl, opConnectSerial, onOpChange, opRemainingSec,
} from './core.js';
import { renderOpJobCard, renderOpTempCard, renderOpFilamentCard } from './cards.js';
import { renderOpControlCard, patchOpControlCard, opControlSig, wireOpControl } from './control.js';
import { renderOpCamBanner, renderOpCamWallBanner, opCamStopAll, opHasCamera } from './camera.js';
import { openOctoAddFlow } from './add-flow.js';

const HERE = new URL('./', import.meta.url).href;
const $ = id => document.getElementById(id);

const meta = { label: "OctoPrint", accent: "#13c100", connection: "Marlin · OctoPrint (LAN)", beta: true };

const schema = {
  docsUrl: "https://docs.octoprint.org/en/master/bundledplugins/appkeys.html",
  sections: [
    { titleKey: "printerSecConnection", fields: [
      { key: "ip", labelKey: "printerLblIP", hintKey: "printerHintOctoIP",
        placeholder: "192.168.1.30", mono: true, required: true },
    ]},
    { fields: [
      { key: "apiKey", labelKey: "printerLblOctoApiKey", hintKey: "printerHintOctoApiKey",
        placeholder: "••••••••", mono: true, required: true, secret: true },
    ]},
  ],
};
const helper = { titleKey: "printerHelperOctoTitle", bulletsKey: "printerHelperOctoBullets" };

// ── Live block ──────────────────────────────────────────────────────────────
const banner = (icon, text) =>
  `<div class="ffg-error-banner"><span class="icon icon-${icon} icon-14"></span><span>${ctx.esc(text)}</span></div>`;

function renderTop(p, conn) {
  const d = conn.data;
  const err = d.printState === "error" && d.stateText ? banner("alert", String(d.stateText)) : "";
  return `${betaBadgeHtml()}${err}${renderOpJobCard(p, conn)}`;
}
// Same order as every other brand: job · control · temperature · filament.
const renderBottom = (p, conn) => `${renderOpTempCard(conn)}${renderOpFilamentCard(p, conn)}`;

function renderLiveInner(p) {
  const conn = opGetConn(p);
  if (!conn) return `
    <div class="snap-empty"><span class="icon icon-cloud icon-18"></span><span>${ctx.esc(ctx.t("snapNoConnection"))}</span></div>`;
  if (conn.status === "error") return betaBadgeHtml() + banner("info", conn.lastError === "auth" ? ctx.t("octoErrAuth") : String(conn.lastError || ""));
  if (conn.status === "connected" && conn.ready && !conn.data.linkUp) {
    return `${betaBadgeHtml()}
      <div class="ffg-error-banner"><span class="icon icon-alert icon-14"></span><span>${ctx.esc(ctx.t("octoLinkDown", { state: conn.data.link || "—" }))}</span></div>
      <button type="button" class="adf-btn adf-btn--secondary octo-link-btn" data-op-serial="1">${ctx.esc(ctx.t("octoLinkConnect"))}</button>`;
  }
  if (conn.status !== "connected" || !conn.ready) return betaBadgeHtml();
  return `<div data-op-part="top">${renderTop(p, conn)}</div>
    <div data-op-part="ctrl" data-sig="${ctx.esc(opControlSig(conn))}">${renderOpControlCard(p, conn)}</div>
    <div data-op-part="bottom">${renderBottom(p, conn)}</div>`;
}

/** Poll refresh: top + bottom re-rendered, the control card patched in place. */
function refreshLive(live, p) {
  const conn = opGetConn(p);
  const top = live.querySelector('[data-op-part="top"]'), ctrl = live.querySelector('[data-op-part="ctrl"]');
  if (!conn || conn.status !== "connected" || !conn.ready || !conn.data.linkUp || !top || !ctrl) {
    live.innerHTML = renderLiveInner(p); wireLive(live, p); return;
  }
  top.innerHTML = renderTop(p, conn);
  live.querySelector('[data-op-part="bottom"]').innerHTML = renderBottom(p, conn);
  const sig = opControlSig(conn);
  if (ctrl.dataset.sig !== sig) { ctrl.dataset.sig = sig; ctrl.innerHTML = renderOpControlCard(p, conn); }
  else patchOpControlCard(ctrl, conn);
  wireLive(live, p);
}

function renderLogInner(p) {
  const log = opGetConn(p)?.log || [];
  if (!log.length) return `<div class="snap-log-empty">${ctx.esc(ctx.t("snapLogEmpty"))}</div>`;
  return log.slice().reverse().map((e, i) => {
    let pretty = e.raw;
    try { pretty = JSON.stringify(JSON.parse(e.raw), null, 2); } catch (_) {}
    return `
      <div class="snap-log-row snap-log-row--${e.dir === "→" ? "out" : "in"}" data-log-idx="${log.length - 1 - i}">
        <button type="button" class="snap-log-row-head" data-row-toggle="1">
          <span class="snap-log-dir">${ctx.esc(e.dir)}</span>
          <span class="snap-log-ts">${ctx.esc(e.ts)}</span>
          <span class="snap-log-summary">${ctx.esc(e.summary)}</span>
          <span class="snap-log-row-chev icon icon-chevron-r icon-13"></span>
        </button>
        <div class="snap-log-detail" hidden>
          <button type="button" class="snap-log-detail-copy" data-copy="${ctx.esc(pretty)}">${ctx.esc(ctx.t("copyLabel"))}</button>
          <pre>${ctx.esc(pretty)}</pre>
        </div>
      </div>`;
  }).join("");
}

function wireLive(root, p) {
  if (!root || !p) return;
  wireOpControl(root, () => ctx.getActivePrinter());
  root.querySelectorAll("[data-op-job]").forEach(btn => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = "1";
    const action = btn.dataset.opJob;
    ctx.setupHoldToConfirm(btn, action === "stop" ? 1500 : 1200, () => opJobControl(p, action));
  });
  root.querySelectorAll("[data-op-serial]").forEach(btn => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => opConnectSerial(p));
  });
}

function renderOnlineBadge(p, where) {
  const online = opIsOnline(p);
  const cls = online === true ? "is-online" : online === false ? "is-offline" : "is-checking";
  const lbl = online === true ? ctx.t("snapStatusOnline") : online === false ? ctx.t("snapStatusOffline") : ctx.t("snapStatusConnecting");
  return `<span class="printer-online printer-online--${ctx.esc(where)} ${cls}"${where === "side" ? ` id="ppOnlineRow"` : ""}>
            <span class="printer-online-dot"></span><span class="printer-online-lbl">${ctx.esc(lbl)}</span>
          </span>`;
}

let _gridRaf = null, _statusRaf = null, _liveRaf = null;
onOpChange((kind, key) => {
  if (kind === "status" || kind === "online") {
    if (!_statusRaf) _statusRaf = requestAnimationFrame(() => { _statusRaf = null; ctx.onPrinterGridChange(); });
    document.querySelectorAll(`[data-printer-key="${CSS.escape(key)}"] .printer-online`).forEach(el => {
      const p = (ctx.getState().printers || []).find(x => opKey(x) === key);
      if (p) el.outerHTML = renderOnlineBadge(p, "card");
    });
    if (kind === "status") ctx.onPrinterStatusChange(key, opGetConn(key)?.status ?? null);
  }
  if (!_gridRaf) _gridRaf = requestAnimationFrame(() => { _gridRaf = null; ctx.onGridJobsChange(); });
  const active = ctx.getActivePrinter();
  if (!active || opKey(active) !== key || _liveRaf) return;
  _liveRaf = requestAnimationFrame(() => {
    _liveRaf = null;
    const live = $("octoprintLive");
    if (live) refreshLive(live, active);
    const logHost = $("octoprintLog");
    if (logHost) logHost.innerHTML = renderLogInner(active);
    const count = $("octoprintLogCount");
    if (count) count.textContent = String(opGetConn(active)?.log?.length || 0);
    const side = $("ppOnlineRow");
    if (side) side.outerHTML = renderOnlineBadge(active, "side");
  });
});

// ── Slots + job (host models) ───────────────────────────────────────────────
// No slots: OctoPrint does not know what is loaded, so the board draws no
// filament widget for these printers (see cards.js).
const getSlots = () => [];
const getUnits = () => [];
function job(p) {
  const conn = opGetConn(p);
  if (!conn || conn.status !== "connected" || !conn.ready || !conn.data.linkUp) return null;
  const d = conn.data;
  return { conn, state: d.printState || "idle", pct: Math.round((d.progress || 0) * 100),
           filename: d.printFilename, remainSec: opRemainingSec(d), thumbUrl: d.printPreviewUrl || null,
           layer: null, layerTotal: null, paused: d.printState === "paused" };
}

// ── Strings ─────────────────────────────────────────────────────────────────
const L = ["en", "fr", "de", "es", "it", "zh", "pt", "pt-pt", "pl", "ru", "nl"];
const s11 = (...v) => Object.fromEntries(L.map((l, i) => [l, v[i]]));
const i18n = {
  octoAddChoiceTitle: s11("Add an OctoPrint printer", "Ajouter une imprimante OctoPrint", "OctoPrint-Drucker hinzufügen", "Añadir una impresora OctoPrint", "Aggiungi una stampante OctoPrint", "添加 OctoPrint 打印机", "Adicionar uma impressora OctoPrint", "Adicionar uma impressora OctoPrint", "Dodaj drukarkę OctoPrint", "Добавить принтер OctoPrint", "OctoPrint-printer toevoegen"),
  octoScanEmpty: s11("No OctoPrint in sight — is the Pi switched on and on this network?", "Aucun OctoPrint en vue — le Pi est bien allumé et sur ce réseau ?", "Kein OctoPrint in Sicht — ist der Pi an und in diesem Netzwerk?", "Ni rastro de OctoPrint: ¿la Pi está encendida y en esta red?", "Nessun OctoPrint all'orizzonte: il Pi è acceso e su questa rete?", "没找到 OctoPrint —— 树莓派开机并连到这个网络了吗？", "Nenhum OctoPrint à vista — o Pi está ligado e nesta rede?", "Nenhum OctoPrint à vista — o Pi está ligado e nesta rede?", "Ani śladu OctoPrinta — czy Pi jest włączone i w tej sieci?", "OctoPrint не видно — Pi включён и в этой сети?", "Geen OctoPrint te zien — staat de Pi aan en op dit netwerk?"),
  octoManualNoReply: s11("No OctoPrint answered at {{ip}}. Check the address — OctoPi listens on port 80, a bare install on 5000.", "Aucun OctoPrint n'a répondu à {{ip}}. Vérifie l'adresse — OctoPi écoute sur le port 80, une install nue sur 5000.", "Unter {{ip}} hat kein OctoPrint geantwortet. Prüf die Adresse — OctoPi lauscht auf Port 80, eine nackte Installation auf 5000.", "Ningún OctoPrint respondió en {{ip}}. Revisa la dirección: OctoPi escucha en el puerto 80, una instalación pelada en el 5000.", "Nessun OctoPrint ha risposto a {{ip}}. Controlla l'indirizzo: OctoPi ascolta sulla porta 80, un'installazione nuda sulla 5000.", "{{ip}} 没有 OctoPrint 回应。请检查地址 —— OctoPi 监听 80 端口，裸装版本在 5000。", "Nenhum OctoPrint respondeu em {{ip}}. Confira o endereço — o OctoPi escuta na porta 80, uma instalação simples na 5000.", "Nenhum OctoPrint respondeu em {{ip}}. Verifica o endereço — o OctoPi escuta na porta 80, uma instalação simples na 5000.", "Pod {{ip}} nie odpowiedział żaden OctoPrint. Sprawdź adres — OctoPi słucha na porcie 80, goła instalacja na 5000.", "По адресу {{ip}} OctoPrint не ответил. Проверь адрес — OctoPi слушает порт 80, голая установка — 5000.", "Geen OctoPrint antwoordde op {{ip}}. Check het adres — OctoPi luistert op poort 80, een kale installatie op 5000."),
  printerHintOctoIP: s11("The address you type to open OctoPrint in your browser (octopi.local works too). Add :5000 for a bare install.", "L'adresse que tu tapes pour ouvrir OctoPrint dans ton navigateur (octopi.local marche aussi). Ajoute :5000 pour une install nue.", "Die Adresse, mit der du OctoPrint im Browser öffnest (octopi.local geht auch). Häng :5000 an für eine nackte Installation.", "La dirección que escribes para abrir OctoPrint en el navegador (octopi.local también vale). Añade :5000 si es una instalación pelada.", "L'indirizzo che digiti per aprire OctoPrint nel browser (va bene anche octopi.local). Aggiungi :5000 per un'installazione nuda.", "就是你在浏览器里打开 OctoPrint 时输入的地址（octopi.local 也行）。裸装版本请加 :5000。", "O endereço que você digita para abrir o OctoPrint no navegador (octopi.local também serve). Adicione :5000 numa instalação simples.", "O endereço que escreves para abrir o OctoPrint no browser (octopi.local também serve). Junta :5000 numa instalação simples.", "Adres, który wpisujesz, żeby otworzyć OctoPrint w przeglądarce (octopi.local też działa). Dopisz :5000 przy gołej instalacji.", "Адрес, по которому ты открываешь OctoPrint в браузере (octopi.local тоже подойдёт). Для голой установки допиши :5000.", "Het adres waarmee je OctoPrint in je browser opent (octopi.local werkt ook). Zet er :5000 achter bij een kale installatie."),
  printerLblOctoApiKey: s11("API key", "Clé API", "API-Schlüssel", "Clave API", "Chiave API", "API 密钥", "Chave de API", "Chave de API", "Klucz API", "API-ключ", "API-sleutel"),
  printerHintOctoApiKey: s11("Filled in for you when you say yes in OctoPrint. By hand: OctoPrint → User settings → Application Keys.", "Rempli pour toi quand tu dis oui dans OctoPrint. À la main : OctoPrint → Réglages utilisateur → Application Keys.", "Wird für dich ausgefüllt, wenn du in OctoPrint zustimmst. Von Hand: OctoPrint → Benutzereinstellungen → Application Keys.", "Se rellena solo cuando dices que sí en OctoPrint. A mano: OctoPrint → Ajustes de usuario → Application Keys.", "Si compila da sola quando dici sì in OctoPrint. A mano: OctoPrint → Impostazioni utente → Application Keys.", "在 OctoPrint 中点同意后会自动填好。手动：OctoPrint → 用户设置 → Application Keys。", "Preenchida para você quando você diz sim no OctoPrint. À mão: OctoPrint → Configurações do usuário → Application Keys.", "Preenchida por ti quando dizes sim no OctoPrint. À mão: OctoPrint → Definições do utilizador → Application Keys.", "Uzupełni się sam, gdy zgodzisz się w OctoPrincie. Ręcznie: OctoPrint → Ustawienia użytkownika → Application Keys.", "Заполнится само, когда ты нажмёшь «да» в OctoPrint. Вручную: OctoPrint → Настройки пользователя → Application Keys.", "Wordt voor je ingevuld zodra je ja zegt in OctoPrint. Met de hand: OctoPrint → Gebruikersinstellingen → Application Keys."),
  printerHelperOctoTitle: s11("Before you start", "Avant de commencer", "Bevor du loslegst", "Antes de empezar", "Prima di iniziare", "开始之前", "Antes de começar", "Antes de começar", "Zanim zaczniesz", "Перед началом", "Voordat je begint"),
  printerHelperOctoBullets: {
    en: ["For Marlin printers (and friends) driven by OctoPrint — usually OctoPi on a Raspberry Pi plugged into the printer's USB.", "Same network as this computer.", "No key to copy: we ask OctoPrint, you click Allow there.", "Still in beta: tell us what your machine does that we don't."],
    fr: ["Pour les imprimantes Marlin (et compagnie) pilotées par OctoPrint — en général OctoPi sur un Raspberry Pi branché en USB sur l'imprimante.", "Même réseau que cet ordinateur.", "Aucune clé à copier : on demande à OctoPrint, tu cliques sur Allow là-bas.", "Encore en bêta : dis-nous ce que ta machine fait et qu'on ne voit pas."],
    de: ["Für Marlin-Drucker (und Co.), die OctoPrint steuert — meist OctoPi auf einem Raspberry Pi am USB des Druckers.", "Gleiches Netzwerk wie dieser Computer.", "Kein Schlüssel zum Kopieren: Wir fragen OctoPrint, du klickst dort auf Allow.", "Noch Beta: Sag uns, was deine Maschine kann und wir noch nicht sehen."],
    es: ["Para impresoras Marlin (y compañía) manejadas por OctoPrint: normalmente OctoPi en una Raspberry Pi conectada por USB a la impresora.", "Misma red que este ordenador.", "Nada de copiar claves: se lo pedimos a OctoPrint y tú pulsas Allow allí.", "Aún en beta: cuéntanos qué hace tu máquina que nosotros no vemos."],
    it: ["Per stampanti Marlin (e simili) gestite da OctoPrint: di solito OctoPi su un Raspberry Pi collegato in USB alla stampante.", "Stessa rete di questo computer.", "Nessuna chiave da copiare: chiediamo a OctoPrint, tu clicchi Allow lì.", "Ancora in beta: dicci cosa fa la tua macchina che noi non vediamo."],
    zh: ["适用于由 OctoPrint 驱动的 Marlin 打印机（及同类）—— 通常是插在打印机 USB 上的树莓派运行 OctoPi。", "与这台电脑在同一网络。", "无需复制密钥：我们向 OctoPrint 申请，你在那边点 Allow 即可。", "仍在测试中：告诉我们你的机器有什么功能我们还没显示。"],
    pt: ["Para impressoras Marlin (e afins) controladas pelo OctoPrint — geralmente OctoPi num Raspberry Pi ligado na USB da impressora.", "Mesma rede deste computador.", "Nenhuma chave para copiar: a gente pede ao OctoPrint e você clica em Allow lá.", "Ainda em beta: conte pra gente o que sua máquina faz e a gente não mostra."],
    "pt-pt": ["Para impressoras Marlin (e afins) controladas pelo OctoPrint — normalmente OctoPi num Raspberry Pi ligado à USB da impressora.", "Mesma rede deste computador.", "Nenhuma chave para copiar: pedimos ao OctoPrint e tu clicas em Allow lá.", "Ainda em beta: diz-nos o que a tua máquina faz e nós não mostramos."],
    pl: ["Dla drukarek Marlin (i podobnych) sterowanych przez OctoPrint — zwykle OctoPi na Raspberry Pi wpiętym w USB drukarki.", "Ta sama sieć co ten komputer.", "Żadnego klucza do kopiowania: pytamy OctoPrinta, a ty klikasz tam Allow.", "Wciąż beta: powiedz nam, co robi twoja maszyna, a czego nie widzimy."],
    ru: ["Для принтеров на Marlin (и родственных), которыми управляет OctoPrint, — обычно OctoPi на Raspberry Pi, подключённом к USB принтера.", "Та же сеть, что и у этого компьютера.", "Ключ копировать не нужно: мы спросим OctoPrint, а ты нажмёшь там Allow.", "Пока бета: расскажи, что умеет твоя машина, а мы не показываем."],
    nl: ["Voor Marlin-printers (en verwanten) die OctoPrint aanstuurt — meestal OctoPi op een Raspberry Pi aan de USB van de printer.", "Zelfde netwerk als deze computer.", "Geen sleutel om te kopiëren: wij vragen het OctoPrint, jij klikt daar op Allow.", "Nog in bèta: vertel ons wat jouw machine doet dat wij niet zien."],
  },
  octoApproveTitle: s11("Say yes in OctoPrint", "Dis oui dans OctoPrint", "Sag ja in OctoPrint", "Di que sí en OctoPrint", "Di' di sì in OctoPrint", "在 OctoPrint 中点同意", "Diga sim no OctoPrint", "Diz que sim no OctoPrint", "Powiedz „tak” w OctoPrincie", "Скажи «да» в OctoPrint", "Zeg ja in OctoPrint"),
  octoApproveAsking: s11("Knocking on OctoPrint's door…", "On frappe à la porte d'OctoPrint…", "Wir klopfen bei OctoPrint an…", "Llamando a la puerta de OctoPrint…", "Bussiamo alla porta di OctoPrint…", "正在敲 OctoPrint 的门……", "Batendo na porta do OctoPrint…", "A bater à porta do OctoPrint…", "Pukamy do drzwi OctoPrinta…", "Стучимся к OctoPrint…", "We kloppen aan bij OctoPrint…"),
  octoApproveWaiting: s11("Open OctoPrint in your browser and click Allow on the access request from Tiger Studio. We'll take it from there.", "Ouvre OctoPrint dans ton navigateur et clique sur Allow dans la demande d'accès de Tiger Studio. On s'occupe du reste.", "Öffne OctoPrint im Browser und klick bei der Zugriffsanfrage von Tiger Studio auf Allow. Den Rest machen wir.", "Abre OctoPrint en el navegador y pulsa Allow en la solicitud de acceso de Tiger Studio. Nosotros nos encargamos del resto.", "Apri OctoPrint nel browser e clicca Allow sulla richiesta di accesso di Tiger Studio. Al resto pensiamo noi.", "在浏览器中打开 OctoPrint，在 Tiger Studio 的访问请求上点 Allow。剩下的交给我们。", "Abra o OctoPrint no navegador e clique em Allow no pedido de acesso do Tiger Studio. A gente cuida do resto.", "Abre o OctoPrint no browser e clica em Allow no pedido de acesso do Tiger Studio. Nós tratamos do resto.", "Otwórz OctoPrint w przeglądarce i kliknij Allow przy prośbie o dostęp od Tiger Studio. Resztą zajmiemy się my.", "Открой OctoPrint в браузере и нажми Allow в запросе доступа от Tiger Studio. Дальше мы сами.", "Open OctoPrint in je browser en klik op Allow bij het toegangsverzoek van Tiger Studio. Wij doen de rest."),
  octoApproveDenied: s11("OctoPrint said no. Ask again, or paste a key instead.", "OctoPrint a dit non. Redemande, ou colle une clé à la place.", "OctoPrint hat nein gesagt. Frag nochmal oder füg einen Schlüssel ein.", "OctoPrint dijo que no. Pide otra vez o pega una clave.", "OctoPrint ha detto no. Chiedi di nuovo o incolla una chiave.", "OctoPrint 拒绝了。再试一次，或直接粘贴密钥。", "O OctoPrint disse não. Peça de novo ou cole uma chave.", "O OctoPrint disse que não. Pede outra vez ou cola uma chave.", "OctoPrint powiedział „nie”. Poproś jeszcze raz albo wklej klucz.", "OctoPrint отказал. Попроси ещё раз или вставь ключ.", "OctoPrint zei nee. Vraag het opnieuw of plak een sleutel."),
  octoApproveTimeout: s11("Nobody clicked Allow in time. Try again, or paste a key instead.", "Personne n'a cliqué sur Allow à temps. Réessaie, ou colle une clé à la place.", "Niemand hat rechtzeitig auf Allow geklickt. Versuch's nochmal oder füg einen Schlüssel ein.", "Nadie pulsó Allow a tiempo. Prueba otra vez o pega una clave.", "Nessuno ha cliccato Allow in tempo. Riprova o incolla una chiave.", "没人及时点 Allow。再试一次，或直接粘贴密钥。", "Ninguém clicou em Allow a tempo. Tente de novo ou cole uma chave.", "Ninguém clicou em Allow a tempo. Tenta outra vez ou cola uma chave.", "Nikt nie kliknął Allow na czas. Spróbuj ponownie albo wklej klucz.", "Никто не нажал Allow вовремя. Попробуй снова или вставь ключ.", "Niemand klikte op tijd op Allow. Probeer opnieuw of plak een sleutel."),
  octoApprovePaste: s11("Paste a key instead", "Coller une clé à la place", "Lieber Schlüssel einfügen", "Pegar una clave", "Incolla una chiave", "改为粘贴密钥", "Colar uma chave", "Colar uma chave", "Wklej klucz", "Вставить ключ", "Liever een sleutel plakken"),
  octoErrAuth: s11("OctoPrint doesn't like this key — check it in this printer's settings.", "OctoPrint n'aime pas cette clé — vérifie-la dans les réglages de cette imprimante.", "OctoPrint mag diesen Schlüssel nicht — prüf ihn in den Einstellungen dieses Druckers.", "A OctoPrint no le gusta esta clave: revísala en los ajustes de esta impresora.", "A OctoPrint non piace questa chiave: controllala nelle impostazioni di questa stampante.", "OctoPrint 不认这个密钥 —— 请在此打印机的设置中检查。", "O OctoPrint não gostou desta chave — confira nas configurações desta impressora.", "O OctoPrint não gostou desta chave — verifica-a nas definições desta impressora.", "OctoPrint nie lubi tego klucza — sprawdź go w ustawieniach tej drukarki.", "OctoPrint не принимает этот ключ — проверь его в настройках принтера.", "OctoPrint lust deze sleutel niet — check hem in de instellingen van deze printer."),
  octoErrCommand: s11("The printer didn't take that one. Try again in a moment.", "L'imprimante n'a pas voulu de celle-là. Réessaie dans un instant.", "Der Drucker wollte das nicht. Versuch's gleich nochmal.", "La impresora no aceptó esa. Prueba otra vez en un momento.", "La stampante non l'ha presa. Riprova tra un attimo.", "打印机没接受这条指令，稍后再试。", "A impressora não aceitou essa. Tente de novo daqui a pouco.", "A impressora não aceitou essa. Tenta outra vez daqui a pouco.", "Drukarka tego nie przyjęła. Spróbuj za chwilę.", "Принтер это не принял. Попробуй чуть позже.", "De printer pikte die niet. Probeer het zo nog eens."),
  octoLinkDown: s11("OctoPrint is up, but the printer isn't plugged into it ({{state}}).", "OctoPrint répond, mais l'imprimante n'y est pas branchée ({{state}}).", "OctoPrint läuft, aber der Drucker hängt nicht dran ({{state}}).", "OctoPrint responde, pero la impresora no está conectada a él ({{state}}).", "OctoPrint risponde, ma la stampante non è collegata ({{state}}).", "OctoPrint 在线，但打印机没连上它（{{state}}）。", "O OctoPrint responde, mas a impressora não está ligada a ele ({{state}}).", "O OctoPrint responde, mas a impressora não está ligada a ele ({{state}}).", "OctoPrint działa, ale drukarka nie jest do niego podłączona ({{state}}).", "OctoPrint на связи, но принтер к нему не подключён ({{state}}).", "OctoPrint draait, maar de printer hangt er niet aan ({{state}})."),
  octoLinkConnect: s11("Connect the printer", "Connecter l'imprimante", "Drucker verbinden", "Conectar la impresora", "Collega la stampante", "连接打印机", "Conectar a impressora", "Ligar a impressora", "Połącz drukarkę", "Подключить принтер", "Printer verbinden"),
  octoCtrlFan: s11("Part fan", "Ventilo pièce", "Bauteillüfter", "Ventilador de pieza", "Ventola pezzo", "模型风扇", "Ventoinha da peça", "Ventoinha da peça", "Wentylator wydruku", "Обдув детали", "Onderdeelventilator"),
  octoCtrlSpeed: s11("Speed", "Vitesse", "Tempo", "Velocidad", "Velocità", "速度", "Velocidade", "Velocidade", "Prędkość", "Скорость", "Snelheid"),
  octoCtrlStep: s11("Step", "Pas", "Schritt", "Paso", "Passo", "步长", "Passo", "Passo", "Krok", "Шаг", "Stap"),
  octoCtrlHome: s11("Home {{axes}}", "Origine {{axes}}", "{{axes}} referenzieren", "Origen {{axes}}", "Home {{axes}}", "{{axes}} 归零", "Home {{axes}}", "Origem {{axes}}", "Bazuj {{axes}}", "Домой {{axes}}", "{{axes}} homen"),
  octoCtrlLocked: s11("Hands off the axes while it prints — fan and speed still answer.", "On ne touche pas aux axes pendant l'impression — ventilo et vitesse répondent toujours.", "Finger weg von den Achsen, solange gedruckt wird — Lüfter und Tempo hören trotzdem.", "Los ejes no se tocan mientras imprime; ventilador y velocidad siguen respondiendo.", "Giù le mani dagli assi mentre stampa: ventola e velocità rispondono comunque.", "打印中请勿动轴 —— 风扇和速度依然可调。", "Nada de mexer nos eixos durante a impressão — ventoinha e velocidade continuam respondendo.", "Nada de mexer nos eixos durante a impressão — ventoinha e velocidade continuam a responder.", "Osie nie do ruszania w trakcie druku — wentylator i prędkość dalej słuchają.", "Оси не трогаем, пока идёт печать — обдув и скорость по-прежнему слушаются.", "Handen af van de assen tijdens het printen — ventilator en snelheid luisteren nog wel."),
};

registerPrinterPlugin({
  id: BRAND,
  meta, schema, helper,
  // No filament identity: no storage widget on the board, no filament card (inventory.js widgetOn).
  noFilament: true,
  css: new URL('octoprint.css', HERE).href,
  models: new URL('models.json', HERE).href,
  logo: true,
  i18n,
  identity: { field: "macAddress", fromDiscovery: () => null, probe: async () => null },

  key: opKey,
  getConn: opGetConn,
  isOnline: opIsOnline,
  connect: p => { if (p?.ip) opConnect(p); },
  disconnect: p => opDisconnect(typeof p === "string" ? p : opKey(p)),
  reconnect: p => { opDisconnect(opKey(p)); if (p?.ip) opConnect(p); },
  ping: p => { if (p?.ip) opPing(p); },
  stopAll: () => { opDisconnectAll(); opCamStopAll(); },
  status: p => opGetConn(p)?.status ?? null,
  job,

  renderLive: p => renderLiveInner(p),
  wireLive,
  renderLog: p => renderLogInner(p),
  logCount: p => opGetConn(p)?.log?.length || 0,
  renderOnlineBadge,
  renderCamBanner: (p, wall) => (wall ? renderOpCamWallBanner(p) : renderOpCamBanner(p)),
  hasCamera: opHasCamera,
  openAddFlow: openOctoAddFlow,

  controlJob: (p, a) => opJobControl(p, a === "stop" ? "stop" : a === "resume" ? "resume" : "pause"),
  getTempHtml: p => renderOpTempCard(opGetConn(p)),
  getSlots, getUnits,
  renderJobCard: renderOpJobCard,
  renderTempCard: renderOpTempCard,
  renderFilamentCard: renderOpFilamentCard,
  renderSettingsWidget: schemaWidget(schema),
});
