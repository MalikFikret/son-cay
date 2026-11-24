// The seat keeper (decision Q70): this tab's live duties for the table where it holds a seat,
// kept across screens. A player may go to Giriş (or Hakkında) and come back without leaving the
// table, so presence and the host watcher must not stop with the waiting room / table screen:
// otherwise the 60 s absence rule would mark them absent and move the host role.
//
// - hold(code, seatId, onError): starts startPresence + watchHost for that seat (once; holding the
//   same seat again only changes who receives the errors).
// - away(onError) / back(): while the table screen is not shown, the keeper also runs
//   runMatchClock (the table runs its own while shown): this device still sends its own timeout
//   at the deadline and the expiry of its own Ganimet offers (only the looter's device does).
// - release(): real leaving only (leaveRoom / deleteRoom, seat lost, room closed). Stops all.
// Errors (SEAT_LOST, ...) go to the current handler; nothing here navigates.

export function createSeatKeeper({ api, uid }) {
  let held = null; // { code, seatId }
  let live = []; // stop functions of presence + host watcher
  let clockStop = null;
  let handler = null;

  const report = (error) => {
    if (typeof handler !== 'function') return;
    try {
      handler(error);
    } catch {
      // A handler must never break a listener.
    }
  };

  function stopAll(list) {
    for (const stop of list) {
      try {
        const result = stop();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch {
        // Already stopped.
      }
    }
  }

  function stopClock() {
    if (clockStop) stopAll([clockStop]);
    clockStop = null;
  }

  return {
    /** The table this tab holds a seat at, or null. */
    current: () => (held ? { ...held } : null),

    hold(code, seatId, onError) {
      handler = onError ?? handler;
      if (held && held.code === code && held.seatId === seatId) return;
      this.release();
      held = { code, seatId };
      try {
        live = [
          api.startPresence({ uid, code, seatId, onError: report }),
          api.watchHost({ uid, code, onError: report }),
        ];
      } catch (error) {
        report(error);
      }
    },

    /** The table screen is shown: it runs its own clock. */
    back(onError) {
      if (onError) handler = onError;
      stopClock();
    },

    /** The table screen is not shown: keep this device's clock duties. */
    away(onError) {
      handler = onError ?? null;
      if (!held || clockStop) return;
      try {
        clockStop = api.runMatchClock({ uid, code: held.code, onError: report });
      } catch (error) {
        report(error);
      }
    },

    release() {
      stopClock();
      stopAll(live.splice(0));
      held = null;
    },
  };
}
