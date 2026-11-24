package pt.joao.zeus;

import android.content.Context;
import android.graphics.Rect;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.webkit.WebView;

/**
 * WebView do Zeus. Ao selecionar texto, o Android mostra o seu menu (Cortar, Copiar, Selecionar tudo…)
 * por cima da seleção — exatamente onde ficam as barras de cores (a dos destaques do Zeus, a do
 * Apolo, a das Notas).
 *  - Nas páginas dos separadores esse menu fica vazio: o Zeus mostra a sua barra (5 cores, Comentar,
 *    Copiar), a mesma do Mac.
 *  - Nas apps (Apolo) e na interface (Notas) o menu fica, mas passa para baixo da seleção (0.5.3):
 *    o Android põe-no por cima da "área do conteúdo" se houver espaço; dizemos-lhe que essa área
 *    começa no topo da página, por isso não há espaço por cima e ele vai para baixo.
 * As pegas da seleção continuam a funcionar.
 */
public class ZWebView extends WebView {
    /** true nas apps (ex.: Apolo): o menu do Android fica como é, sem a barra de destaques */
    public boolean plain = false;

    public ZWebView(Context c) { super(c); }

    @Override
    public ActionMode startActionMode(ActionMode.Callback cb, int type) {
        return super.startActionMode(wrap(cb, !plain), type);
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback cb) {
        return super.startActionMode(wrap(cb, !plain));
    }

    private ActionMode.Callback wrap(final ActionMode.Callback cb, final boolean empty) {
        return new ActionMode.Callback2() {
            @Override public boolean onCreateActionMode(ActionMode m, Menu menu) {
                boolean r = cb.onCreateActionMode(m, menu);
                if (empty) menu.clear();
                return r;
            }
            @Override public boolean onPrepareActionMode(ActionMode m, Menu menu) {
                boolean r = cb.onPrepareActionMode(m, menu);
                if (empty) { menu.clear(); return true; }
                return r;
            }
            @Override public boolean onActionItemClicked(ActionMode m, MenuItem item) { return cb.onActionItemClicked(m, item); }
            @Override public void onDestroyActionMode(ActionMode m) { cb.onDestroyActionMode(m); }
            @Override public void onGetContentRect(ActionMode m, View v, Rect out) {
                if (cb instanceof ActionMode.Callback2) ((ActionMode.Callback2) cb).onGetContentRect(m, v, out);
                else super.onGetContentRect(m, v, out);
                if (!empty) out.top = 0;   // o menu do Android vai para baixo da seleção
            }
        };
    }
}
