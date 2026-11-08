/**
 * Preferences for apps and toolkits with a style of their own
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import Adw from 'gi://Adw';
import GObject from 'gi://GObject';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {EntryStyle, addStyleGroups} from './styleGroups.js';
import {AppListGroup} from './appListGroup.js';

export const AppStylesPage = GObject.registerClass(
class AppStylesPage extends Adw.PreferencesPage {
    /**
     * @param {Gio.Settings} settings
     * @param {GeneralStyle} general - The style that app and toolkit styles come before.
     * @param {Adw.PreferencesWindow} window - Shows the page of each entry.
     */
    constructor(settings, general, window) {
        super({title: _('App Styles'), icon_name: 'preferences-desktop-appearance-symbolic'});

        this.add(new AppListGroup(settings, 'app-styles', 'toolkit-styles', {
            title: _('Apps and Toolkits'),
            description: _('An app’s style comes before its toolkit’s'),
            notes: new Map([
                ['libadwaita', _('Needs Round libadwaita Apps')],
                ['libhandy', _('Needs Round libhandy Apps')],
            ]),
            open: (key, id, name) => {
                const page = new Adw.PreferencesPage();
                addStyleGroups(page, new EntryStyle(settings, key, id), key === 'app-styles'
                    ? _('Replaces the toolkit and general styles')
                    : _('Replaces the general style'), general);
                const view = new Adw.ToolbarView({content: page});
                view.add_top_bar(new Adw.HeaderBar());
                window.push_subpage(new Adw.NavigationPage({title: name, child: view}));
            },
        }));
    }
});
