/**
 * Preferences window
 *
 * @author     Ahmet Öztürk <141689708+ztrahmet@users.noreply.github.com>
 * @copyright  2026 Ahmet Öztürk
 * @license    GPL-3.0-or-later
 */

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {AppsPage} from './prefs/appsPage.js';
import {AppStylesPage} from './prefs/appStylesPage.js';
import {GeneralPage} from './prefs/generalPage.js';

export default class RoundedWindowCornersPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.add(new GeneralPage(settings));
        window.add(new AppsPage(settings));
        window.add(new AppStylesPage(settings, window));
    }
}
