// Entry point. The UI shell (src/ui) is owned by the design lane; this file only mounts it.
import { mount } from './ui/app';

const root = document.getElementById('app');
if (root) {
    mount(root);
}
