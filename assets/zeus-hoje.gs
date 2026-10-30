/**
 * Zeus · Hoje — agenda e tarefas do dia para a página principal do Zeus.
 *
 * Instalação (uma vez por conta Google):
 *  1. Cola este código num projeto novo do Apps Script (script.new), substituindo o que lá estiver.
 *  2. Serviços (+) › "Google Tasks API" › Adicionar.
 *  3. Implementar › Nova implementação › Tipo: Aplicação Web.
 *     Executar como: Eu · Quem tem acesso: Qualquer pessoa.
 *  4. Autoriza o acesso e copia o URL da aplicação Web para o Zeus.
 *
 * Só lê a agenda e as tarefas desta conta; a única alteração possível é marcar uma tarefa como concluída
 * (quando carregas no visto, no Zeus). Só responde a quem tiver a chave abaixo, que só o Zeus conhece.
 */
var ZEUS_KEY = '';
var TASKS_MISSING = 'Falta o serviço Google Tasks API: no editor, Serviços (+) › Google Tasks API › Adicionar, e depois uma versão nova da implementação.';

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (ZEUS_KEY && p.k !== ZEUS_KEY) return out_({ ok: false, error: 'Chave errada.' });
  try {
    if (p.action === 'done' && p.list && p.task) {
      if (typeof Tasks === 'undefined') return out_({ ok: false, error: TASKS_MISSING });
      Tasks.Tasks.patch({ status: 'completed' }, p.list, p.task);
      return out_({ ok: true });
    }
    return out_(hoje_(p.date));
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

function hoje_(dateStr) {
  var tz = Session.getScriptTimeZone();
  var start = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  start.setHours(0, 0, 0, 0);
  var end = new Date(start.getTime()); end.setDate(end.getDate() + 1);
  var today = Utilities.formatDate(start, tz, 'yyyy-MM-dd');

  // agenda: todos os calendários visíveis
  var events = [];
  CalendarApp.getAllCalendars().forEach(function (cal) {
    try { if (cal.isHidden() || !cal.isSelected()) return; } catch (x) {}
    cal.getEvents(start, end).forEach(function (ev) {
      var mine = null;
      try { mine = ev.getMyStatus(); } catch (x) {}
      if (mine && String(mine) === 'NO') return; // recusados
      var desc = '';
      try { desc = ev.getDescription() || ''; } catch (x) {}
      var meet = (desc.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i) || [''])[0];
      events.push({
        id: ev.getId(),
        title: ev.getTitle() || '(sem título)',
        start: ev.getStartTime().toISOString(),
        end: ev.getEndTime().toISOString(),
        allDay: ev.isAllDayEvent(),
        calendar: cal.getName(),
        color: cal.getColor(),
        location: ev.getLocation() || '',
        meet: meet
      });
    });
  });

  // tarefas: por fazer, com data até hoje (inclui as atrasadas)
  var tasks = [];
  if (typeof Tasks === 'undefined') {
    return { ok: true, v: 1, account: Session.getActiveUser().getEmail(), date: today, events: events, tasks: [], tasksError: TASKS_MISSING };
  }
  var lists = (Tasks.Tasklists.list({ maxResults: 100 }).items) || [];
  lists.forEach(function (l) {
    var page = null;
    do {
      var r = Tasks.Tasks.list(l.id, { showCompleted: false, showHidden: false, maxResults: 100, pageToken: page });
      (r.items || []).forEach(function (t) {
        if (!t.due || !t.title) return;
        var due = String(t.due).slice(0, 10);
        if (due > today) return;
        tasks.push({ id: t.id, list: l.id, listName: l.title, title: t.title, due: due, overdue: due < today, notes: t.notes || '' });
      });
      page = r.nextPageToken;
    } while (page);
  });

  return { ok: true, v: 1, account: Session.getActiveUser().getEmail(), date: today, events: events, tasks: tasks };
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
