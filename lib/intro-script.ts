// Shared with the root layout (a server file), so it lives outside the client component.
/** Runs once, in <head>, on the very first page load. */
export const INTRO_SCRIPT = `try{var d=document.documentElement;if(location.pathname!=="/"||sessionStorage.getItem("rux-intro"))d.dataset.intro="skip";else{sessionStorage.setItem("rux-intro","1");d.dataset.intro="play"}}catch(e){document.documentElement.dataset.intro="skip"}`;
