# Hold-to-confirm buttons

**Rule.** Destructive or binding actions use `setupHoldToConfirm(el, ms, callback)`, and the hold fill must be visible on that button.

**Why.** A hold button without a visible fill reads as broken: users let go before the action fires.

**How.** The button contains `<span class="hold-progress"></span>`; 1200 ms for reversible actions, 1500 ms for hard-destructive ones. On a red/danger button override the default red fill, e.g. `.my-btn .hold-progress { background: rgba(0,0,0,.34); opacity: 1; }`.
