/**
 * Preferences window
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {EntrySettings} from './lib/entrySettings.js';
import {AppsPage} from './prefs/appsPage.js';
import {AppStylesPage} from './prefs/appStylesPage.js';
import {GeneralPage} from './prefs/generalPage.js';

export default class RoundedWindowCornersPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const appearance = settings.get_child('appearance');
        const entrySettings = new EntrySettings(settings, this.path);
        window.add(new GeneralPage(settings, appearance, entrySettings));
        window.add(new AppsPage(settings));
        window.add(new AppStylesPage(settings, appearance, entrySettings, window));
    }
}
