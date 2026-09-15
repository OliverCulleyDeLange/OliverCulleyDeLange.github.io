import { MAX_NAME_LENGTH, sanitizeProfile, type Profile } from '../../../../workers/dolphin-multiplayer/src/protocol';
import { listCountries } from './flags';
import type { ConnectionStatus } from './multiplayer';
import { SKINS } from './skins';

/* The little strip of controls above the canvas: name, flag and skin.
   Plain HTML because a text field is the one thing a canvas does badly. */

export interface ProfileUI {
  setStatus(status: ConnectionStatus, online: number, room: string): void;
  destroy(): void;
}

export function mountProfileUI(root: HTMLElement, initial: Profile, onChange: (profile: Profile) => void): ProfileUI {
  const form = document.createElement('form');
  form.className = 'dolphin-profile';
  form.autocomplete = 'off';
  form.addEventListener('submit', (event) => event.preventDefault());

  const nameLabel = document.createElement('label');
  nameLabel.className = 'dolphin-profile-field';
  nameLabel.append('Name');
  const name = document.createElement('input');
  name.type = 'text';
  name.maxLength = MAX_NAME_LENGTH;
  name.value = initial.name;
  name.spellcheck = false;
  name.setAttribute('aria-label', 'Your name, shown to other players');
  nameLabel.append(name);

  const flagLabel = document.createElement('label');
  flagLabel.className = 'dolphin-profile-field';
  flagLabel.append('Flag');
  const flag = document.createElement('select');
  flag.setAttribute('aria-label', 'Your country flag');
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'No flag';
  flag.append(none);
  for (const country of listCountries()) {
    const option = document.createElement('option');
    option.value = country.code;
    option.textContent = `${country.flag} ${country.name}`;
    flag.append(option);
  }
  flag.value = initial.flag;
  flagLabel.append(flag);

  const skins = document.createElement('fieldset');
  skins.className = 'dolphin-skins';
  const legend = document.createElement('legend');
  legend.textContent = 'Dolphin';
  skins.append(legend);
  let skin = initial.skin;
  const swatches: HTMLButtonElement[] = [];
  for (const entry of SKINS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dolphin-skin';
    button.title = entry.name;
    button.setAttribute('aria-label', `${entry.name} dolphin`);
    button.style.setProperty('--skin-body', entry.body);
    button.style.setProperty('--skin-belly', entry.belly);
    button.style.setProperty('--skin-line', entry.line);
    button.addEventListener('click', () => {
      skin = entry.id;
      reflect();
      emit();
    });
    swatches.push(button);
    skins.append(button);
  }

  const status = document.createElement('output');
  status.className = 'dolphin-status';
  status.setAttribute('aria-live', 'polite');

  form.append(nameLabel, flagLabel, skins, status);
  root.replaceChildren(form);

  function current(): Profile {
    return sanitizeProfile({ name: name.value, flag: flag.value, skin });
  }

  function reflect(): void {
    for (let i = 0; i < SKINS.length; i++) swatches[i].setAttribute('aria-pressed', String(SKINS[i].id === skin));
  }

  let last = JSON.stringify(initial);
  function emit(): void {
    const profile = current();
    const key = JSON.stringify(profile);
    if (key === last) return;
    last = key;
    onChange(profile);
  }

  let debounce: number | null = null;
  const onNameInput = (): void => {
    if (debounce != null) window.clearTimeout(debounce);
    debounce = window.setTimeout(emit, 400);
  };
  const onNameKey = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      name.blur();
    }
  };
  const onNameBlur = (): void => {
    const profile = current();
    if (name.value !== profile.name) name.value = profile.name;
    emit();
  };
  name.addEventListener('input', onNameInput);
  name.addEventListener('keydown', onNameKey);
  name.addEventListener('blur', onNameBlur);
  flag.addEventListener('change', emit);

  reflect();

  return {
    setStatus(state, online, room) {
      status.dataset.status = state;
      if (state === 'online') {
        status.textContent = `● ${online} online in ${room}`;
      } else if (state === 'connecting') {
        status.textContent = '○ connecting…';
      } else {
        status.textContent = '○ offline';
      }
    },
    destroy() {
      if (debounce != null) window.clearTimeout(debounce);
      form.remove();
    },
  };
}
