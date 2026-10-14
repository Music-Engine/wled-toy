import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'shader', component: () => import('./pages/ShaderPage.vue') },
    { path: '/graph', name: 'graph', component: () => import('./pages/GraphPage.vue') },
    { path: '/reference', name: 'reference', component: () => import('./pages/ReferencePage.vue') },
    ...(import.meta.env.DEV ? [{ path: '/dev/nodes', name: 'node-gallery', component: () => import('./features/node-ui/gallery/NodeGallery.vue') }] : []),
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
