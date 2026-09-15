import { sanitizeProfile, type Profile } from '../../../../workers/dolphin-multiplayer/src/protocol';
import { guessCountry } from './flags';

/* Who you are to the other players: a name, a flag and a skin, remembered
   in this browser. */

const PROFILE_KEY = 'odl-dolphin-olympics-profile';

function defaultProfile(): Profile {
  return sanitizeProfile({ name: `Dolphin ${Math.floor(Math.random() * 90) + 10}`, flag: guessCountry(), skin: 'classic' });
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return sanitizeProfile(JSON.parse(raw));
  } catch (error) {}
  const profile = defaultProfile();
  saveProfile(profile);
  return profile;
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (error) {}
}
