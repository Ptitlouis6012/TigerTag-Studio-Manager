/**
 * printers/prusa/settings.js — Prusa brand metadata & form schema.
 * Pure data, no dependencies.
 *
 * Every Prusa that runs PrusaLink is reached the same way: its IP, and the
 * user + password PrusaLink shows (Buddy firmware: Settings → Network →
 * PrusaLink; user `maker`). A Raspberry-Pi PrusaLink (MK3S+, MK2.5S) lets the
 * owner pick another user name, hence the optional field. The camera address
 * is the Buddy3D camera's OWN IP — only when its local RTSP stream is on.
 */

export const meta = {
  label: "Prusa",
  accent: "#fa6831",
  connection: "PrusaLink (LAN)",
  beta: true          // brand picker shows a "Beta" tag until it is proven on real printers
};

export const schema = {
  docsUrl: "https://help.prusa3d.com/article/prusa-connect-and-prusalink-explained_302608",
  sections: [
    { titleKey: "printerSecConnection", fields: [
      { key: "ip", labelKey: "printerLblIP", hintKey: "printerHintPrusaIP",
        placeholder: "192.168.1.60", mono: true, required: true }
    ]},
    { fields: [
      { key: "password", labelKey: "printerLblPrusaPassword", hintKey: "printerHintPrusaPassword",
        placeholder: "••••••••", mono: true, required: true, secret: true },
      { key: "username", labelKey: "printerLblPrusaUser", hintKey: "printerHintPrusaUser",
        placeholder: "maker", mono: true, required: false }
    ]},
    { fields: [
      { key: "cameraIp", labelKey: "printerLblPrusaCamera", hintKey: "printerHintPrusaCamera",
        placeholder: "192.168.1.61", mono: true, required: false }
    ]}
  ]
};

export const helper = {
  titleKey:   "printerHelperPrusaTitle",
  bulletsKey: "printerHelperPrusaBullets"
};
