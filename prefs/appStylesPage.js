/**
 * Preferences for apps with a style of their own
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {addAppearanceGroups} from './appearanceGroups.js';
import {AppListGroup} from './appListGroup.js';

export const AppStylesPage = GObject.registerClass(
class AppStylesPage extends Adw.PreferencesPage {
    /**
     * @param {Gio.Settings} settings
     * @param {Adw.PreferencesWindow} window - Shows the page of each app.
     */
    constructor(settings, window) {
        super({title: _('App Styles'), icon_name: 'preferences-desktop-appearance-symbolic'});

        const schema = settings.get_child('appearance').settings_schema;
        const appearanceOf = id => new Gio.Settings({settings_schema: schema, path: `${settings.path}apps/${id}/`});

        this.add(new AppListGroup(settings, 'styled-apps', {
            title: _('App Styles'),
            description: _('These apps have a custom style of their own, which starts as libadwaita’s.'),
            open: (id, name) => {
                const page = new Adw.PreferencesPage();
                addAppearanceGroups(page, appearanceOf(id), false);
                const view = new Adw.ToolbarView({content: page});
                view.add_top_bar(new Adw.HeaderBar());
                window.push_subpage(new Adw.NavigationPage({title: name, child: view}));
            },
            // So an app added again starts from libadwaita's style.
            removed: id => {
                const appearance = appearanceOf(id);
                for (const key of schema.list_keys())
                    appearance.reset(key);
            },
        }));
    }
});
