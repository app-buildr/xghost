# xGhost

Extension Chrome (Manifest V3) qui détecte les comptes X qui ont arrêté de te suivre.
Spécification : `resources/spec/SPEC.md`.

## Démarrer

```bash
pnpm install
pnpm dev        # Chrome avec l'extension chargée et rechargement à chaud
pnpm build      # build de production dans dist/
pnpm test       # tests unitaires (Vitest)
pnpm typecheck
pnpm icons      # régénère les icônes PNG (normale, scan, déconnecté)
```

Charger le build à la main : `chrome://extensions` → mode développeur → « Charger l'extension non empaquetée » → `dist`.

## Architecture (par fonctionnalité)

```
src/
├── entrypoints/           # WXT : background, scripts x.com (page + isolé), popup, options, onboarding
├── features/
│   ├── x-api/             # session (cookies), lecture et validation des réponses GraphQL de x.com
│   ├── followers-sync/    # moteur de scan par onglet, instantanés, profils, estimation du temps restant
│   ├── hidden-render/     # rendu simulé de l'onglet de scan quand il est caché
│   ├── scan-veil/         # overlay de l'onglet de scan (titre, favicon de progression)
│   ├── unfollow-detection/# comparaison, contrôle léger, arrêt anticipé, garde-fous, réparation de l'historique
│   ├── events/            # événements : format compact, sync/archive, sélecteurs, non vus, commandes
│   ├── accounts/          # comptes suivis (multi-comptes), comptes ignorés
│   ├── settings/          # réglages + interface
│   ├── scheduler/         # alarmes, ajout automatique des comptes, multi-machines
│   ├── alerts/            # badge/icône et notifications
│   ├── app-state/         # hooks React d'accès aux données
│   ├── scan-status/       # textes d'état du scan partagés + bandeau
│   ├── dashboard/ departures/ popup/ options/ onboarding/   # interfaces
└── shared/                # stockage (sync avec repli local), messagerie typée, thème et jetons, utilitaires
```

Le service worker est le seul à écrire. Les interfaces lisent le stockage directement et envoient leurs commandes par messages typés (`shared/messaging/protocol.ts`), acceptés uniquement depuis les pages de l'extension.

## Récupération des abonnés (§ 4.6)

xGhost n'envoie **aucune requête** à X (pas de forge d'en-tête anti-bot). Il ouvre x.com et lit les réponses que la page reçoit elle-même.

- **Onglet de scan** ouvert avec le fragment `#xghost` : seul cet onglet est instrumenté. Le script de page (monde MAIN) y lit les réponses `Followers`, `UserByScreenName` et `UserByRestId`, et les transmet au script isolé par un `MessageChannel` privé, échangé avant tout code de x.com. Les autres onglets x.com ne sont pas touchés.
- **Contrôle léger** (« Vérifier maintenant », alarmes) : onglet caché, sans défilement. Total annoncé + 50 premiers abonnés → arrivées, départs récents (comparés à l'ordre enregistré), écart restant. Total X en retard : nouvelle vérification 10 min plus tard.
- **Scan complet** (écart inexpliqué, « Scan complet », référence, contrôle tous les 10 contrôles légers) : onglet épinglé en arrière-plan avec overlay. S'arrête dès que les départs annoncés sont trouvés quand il est déclenché par un écart.
- **Couverture** (§ 4.7) : complet à 99 % du total X. Un scan incomplet n'est jamais comparé ; ses abonnés sont gardés pour « Continuer le scan ».
- **Limite de X** (429, erreur 88, `x-rate-limit-remaining: 0`) : pause jusqu'à l'heure annoncée, puis reprise automatique.

## Choix appliqués

1. Un départ est « vu » dès qu'il est affiché ; il garde l'étiquette « Nouveau » jusqu'à ce qu'on quitte la page.
2. « Suivre aussi mes abonnements » est affiché désactivé (« bientôt disponible »), reporté en v2.
3. Une notification groupée par vérification.
4. Historique illimité : 500 événements max par compte en sync (moins si le quota l'impose), le reste en archive locale.
5. Les réglages sont globaux, sauf « Uniquement les mutuels », propre à chaque compte.
6. Le statut des comptes partis (suspendu, supprimé) n'est pas vérifié : xGhost n'ouvre jamais leur profil.

Le bloc « Données » (export CSV, « Refaire le scan initial ») n'est pas implémenté, à la demande.
