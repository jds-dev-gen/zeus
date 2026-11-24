package pt.joao.zeus;

import android.content.Context;
import android.graphics.Rect;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.webkit.WebView;

/**
 * Página de um separador. Ao selecionar texto, o Android mostra o seu menu (Copiar, Partilhar…);
 * aqui esse menu fica vazio, porque o Zeus mostra a sua barra de destaques (as 5 cores, Comentar,
 * Copiar) — a mesma do Mac. As pegas da seleção continuam a funcionar.
 */
public class ZWebView extends WebView {
    /** true nas apps (ex.: Apolo): o menu do Android fica como é, sem a barra de destaques */
    public boolean plain = false;

    public ZWebView(Context c) { super(c); }

    @Override
    public ActionMode startActionMode(ActionMode.Callback cb, int type) {
        return super.startActionMode(plain ? cb : wrap(cb), type);
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback cb) {
        return super.startActionMode(plain ? cb : wrap(cb));
    }

    private ActionMode.Callback wrap(final ActionMode.Callback cb) {
        return new ActionMode.Callback2() {
            @Override public boolean onCreateActionMode(ActionMode m, Menu menu) {
                boolean r = cb.onCreateActionMode(m, menu);
                menu.clear();
                return r;
            }
            @Override public boolean onPrepareActionMode(ActionMode m, Menu menu) {
                cb.onPrepareActionMode(m, menu);
                menu.clear();
                return true;
            }
            @Override public boolean onActionItemClicked(ActionMode m, MenuItem item) { return cb.onActionItemClicked(m, item); }
            @Override public void onDestroyActionMode(ActionMode m) { cb.onDestroyActionMode(m); }
            @Override public void onGetContentRect(ActionMode m, View v, Rect out) {
                if (cb instanceof ActionMode.Callback2) ((ActionMode.Callback2) cb).onGetContentRect(m, v, out);
                else super.onGetContentRect(m, v, out);
            }
        };
    }
}
