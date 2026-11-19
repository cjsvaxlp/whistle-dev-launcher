import { bindDialogs } from './panel/dialogs.mjs';
import { load, openSelectedLogs, setStatus } from './panel/projects.mjs';
import { bindWhistleControls } from './panel/whistle.mjs';

const { showDoctor, showRule } = bindDialogs({ load, setStatus });
bindWhistleControls({ load, setStatus });

await load();
const params = new URLSearchParams(location.search);
if (!localStorage.getItem('cafe-doctor-seen') && params.get('doctor') !== '0') showDoctor({ auto: true });
if (params.get('rule') === '1') showRule();
if (params.get('log') === '1') openSelectedLogs();
setInterval(load, 2000);
