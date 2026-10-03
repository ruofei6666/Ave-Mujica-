import { createApp } from 'vue';
import App from './App.vue';
import './styles/tailwind.css';
import { loadUiArt } from './game/ui-art';

createApp(App).mount('#app');
// Generated art is optional: missing files simply leave the code-drawn look in place.
void loadUiArt();
