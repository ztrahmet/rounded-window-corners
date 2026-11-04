/**
 * Preferences for apps and app categories with a style of their own
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
     * @param {Adw.PreferencesWindow} window - Shows the page of each entry.
     */
    constructor(settings, window) {
        super({title: _('App Styles'), icon_name: 'preferences-desktop-appearance-symbolic'});

        const schema = settings.get_child('appearance').settings_schema;
        const appearanceOf = (key, id) => new Gio.Settings({
            settings_schema: schema,
            path: `${settings.path}${key === 'styled-apps' ? 'apps' : 'categories'}/${id}/`,
        });

        this.add(new AppListGroup(settings, 'styled-apps', 'styled-categories', {
            title: _('Apps and Categories'),
            description: _('An app’s style comes before its category’s'),
            notes: new Map([
                ['libadwaita', _('Needs Round libadwaita Apps')],
                ['libhandy', _('Needs Round libhandy Apps')],
            ]),
            open: (key, id, name) => {
                const page = new Adw.PreferencesPage();
                addAppearanceGroups(page, appearanceOf(key, id), key === 'styled-apps'
                    ? _('Replaces the category and general styles')
                    : _('Replaces the general style'));
                const view = new Adw.ToolbarView({content: page});
                view.add_top_bar(new Adw.HeaderBar());
                window.push_subpage(new Adw.NavigationPage({title: name, child: view}));
            },
            // So an entry added again starts afresh.
            removed: (key, id) => {
                const appearance = appearanceOf(key, id);
                for (const name of schema.list_keys())
                    appearance.reset(name);
            },
        }));
    }
});
