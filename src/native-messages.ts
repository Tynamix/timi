import type { Locale } from './shared';
export const nativeMessages = {
  en: {
    today: 'Today', work: 'Working', break: 'On break', pending: 'Time needs clarification', stopped: 'Not tracking',
    overview: 'Weekly overview', settings: 'Settings', quit: 'Quit timi', entry: 'Choose a project', stop: 'Stop tracking',
    startup: 'timi could not open its time records. Your data has not been replaced. Check that the data folder is accessible and that no other timi version is running, then try again.',
    save: 'Saving failed. The action was not completed. Your previous tracking state is preserved. Check available disk space and access to the data folder, then retry.',
    clock: 'The system clock moved backwards. Restore the correct time before continuing; no records have been changed.',
    activity: 'Native inactivity could not be read. Tracking actions are paused until the system activity service becomes available.',
    retry: 'Retry', stayOpen: 'Keep timi open', exit: 'Close', edit: 'Edit', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All',
  },
  de: {
    today: 'Heute', work: 'Arbeit läuft', break: 'Pause läuft', pending: 'Zeit muss zugeordnet werden', stopped: 'Keine Zeiterfassung',
    overview: 'Wochenübersicht', settings: 'Einstellungen', quit: 'timi beenden', entry: 'Projekt auswählen', stop: 'Zeiterfassung stoppen',
    startup: 'timi konnte die Zeitdaten nicht öffnen. Deine Daten wurden nicht ersetzt. Prüfe den Zugriff auf den Datenordner und ob eine andere timi-Version läuft. Versuche es dann erneut.',
    save: 'Speichern fehlgeschlagen. Die Aktion wurde nicht ausgeführt. Der vorherige Erfassungszustand bleibt erhalten. Prüfe den freien Speicherplatz und den Zugriff auf den Datenordner und versuche es erneut.',
    clock: 'Die Systemuhr wurde zurückgestellt. Stelle vor dem Fortfahren die richtige Uhrzeit wieder her. Es wurden keine Einträge geändert.',
    activity: 'Die native Inaktivität konnte nicht gelesen werden. Erfassungsaktionen warten, bis die Systemaktivität wieder verfügbar ist.',
    retry: 'Erneut versuchen', stayOpen: 'timi geöffnet lassen', exit: 'Schließen', edit: 'Bearbeiten', undo: 'Widerrufen', redo: 'Wiederholen', cut: 'Ausschneiden', copy: 'Kopieren', paste: 'Einsetzen', selectAll: 'Alles auswählen',
  },
} as const;
export function detectLocale(languages: string[]): Locale { return languages[0]?.toLowerCase().startsWith('de') ? 'de' : 'en'; }
