// Classic script, loaded before the modules. Collects page errors so the
// Diagnostics tab can show them even if a module fails to load.
(function () {
  var list = [];
  window.__cbErrors = list;
  function add(msg) {
    msg = String(msg);
    // Same error again (for example every frame): count it, do not flood the list.
    for (var i = 0; i < list.length; i++) {
      if (list[i].msg === msg) { list[i].count++; window.dispatchEvent(new CustomEvent('cb-error')); return; }
    }
    if (list.length >= 200) list.shift();
    list.push({ t: new Date().toISOString(), msg: msg, count: 1 });
    window.dispatchEvent(new CustomEvent('cb-error'));
  }
  window.__cbAddError = add;
  window.addEventListener('error', function (e) {
    var where = e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : '';
    add((e.message || 'Script or resource failed to load') + where);
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    add('Unhandled promise rejection: ' + (r && r.message ? r.message : r));
  });
})();
