<p align="center">
  <img src="public/icon/128.png" alt="" width="128" />
</p>

<h1 align="center">xGhost</h1>

<p align="center">
  Détecte les comptes X qui ont arrêté de te suivre, et te prévient.<br />
  Extension pour Chrome et les navigateurs compatibles (Brave, Edge, Arc…).
</p>

<p align="center">
  <a href="https://app-buildr.github.io/xghost/"><strong>Site et guide d'utilisation</strong></a> ·
  <a href="https://github.com/app-buildr/xghost/releases/latest/download/xghost.zip">Télécharger</a>
</p>

## Documentation

Tout est expliqué, captures à l'appui, sur le site de l'extension :
**[app-buildr.github.io/xghost](https://app-buildr.github.io/xghost/)**

- [Présentation](https://app-buildr.github.io/xghost/) : à quoi sert l'extension, en images
- [Mise à jour](https://app-buildr.github.io/xghost/#mise-a-jour) : installer une nouvelle version

## Fonctionnalités

- **Départs** : la liste des comptes qui ont arrêté de te suivre, avec la date. Un départ garde
  l'étiquette « Nouveau » jusqu'à ce que tu quittes la page.
- **Arrivées** : les nouveaux abonnés, dans un panneau à part.
- **Vérifications automatiques** : xGhost contrôle tes abonnés à intervalles réguliers, sans que tu
  aies à y penser. **Vérifier maintenant** lance un contrôle à la demande.
- **Alertes** : un badge sur l'icône et une notification groupée par vérification.
- **Plusieurs comptes** : chaque compte X connecté est suivi séparément, avec ses propres départs.
  Des comptes peuvent être ignorés, et « Uniquement les mutuels » se règle compte par compte.
- **Historique illimité** : synchronisé entre tes navigateurs Chrome, le surplus gardé en local.
- **Aucune requête envoyée à X** : xGhost ouvre x.com dans un onglet et lit simplement ce que la
  page reçoit. Tes autres onglets x.com ne sont pas touchés, et rien ne quitte ton navigateur.
- **Mises à jour** : un bandeau prévient quand une nouvelle version est disponible.
- **Bientôt** : suivre aussi tes abonnements.

## Installation

xGhost ne passe pas par le Chrome Web Store : on le charge en **mode développeur**, une option
standard de Chrome. Compte deux minutes.

1. [**Télécharge xGhost (.zip)**](https://github.com/app-buildr/xghost/releases/latest/download/xghost.zip),
   puis décompresse l'archive. Range le dossier `xGhost` dans un endroit où il restera, par exemple
   `Documents` : le navigateur en a besoin en permanence.
2. Ouvre `chrome://extensions` (`brave://extensions` ou `edge://extensions` selon ton navigateur).
3. Active le **Mode développeur**, en haut à droite.
4. Clique sur **Charger l'extension non empaquetée**, puis choisis le dossier `xGhost`.
5. Épingle l'icône : pièce de puzzle à droite de la barre d'adresse, puis l'épingle à côté de xGhost.
6. Connecte-toi à [x.com](https://x.com/login) si ce n'est pas déjà fait, puis suis l'accueil de
   l'extension : le premier scan enregistre tes abonnés actuels.

---

# Développement

Extension Chrome Manifest V3 en TypeScript, construite avec [WXT](https://wxt.dev), interface en
React.

## Démarrer

```bash
pnpm install
pnpm dev        # Chrome avec l'extension chargée et rechargement à chaud
```

## Commandes

| Commande         | Rôle                                                       |
| ---------------- | ---------------------------------------------------------- |
| `pnpm dev`       | mode dev (WXT), rechargement à chaud                       |
| `pnpm build`     | build de production dans `dist/`                           |
| `pnpm package`   | build puis archive `xghost.zip` (dossier `xGhost`)         |
| `pnpm test`      | tests unitaires (Vitest)                                   |
| `pnpm typecheck` | vérifie les types                                          |
| `pnpm icons`     | régénère les icônes PNG (normale, scan, déconnecté)        |

Charger le build à la main : `chrome://extensions` → mode développeur → « Charger l'extension non
empaquetée » → `dist`.

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
│   ├── updates/           # vérification des nouvelles versions (releases GitHub) + bandeau
│   ├── dashboard/ departures/ popup/ options/ onboarding/   # interfaces
└── shared/                # stockage (sync avec repli local), messagerie typée, thème et jetons, utilitaires
```

Le service worker est le seul à écrire. Les interfaces lisent le stockage directement et envoient
leurs commandes par messages typés (`shared/messaging/protocol.ts`), acceptés uniquement depuis les
pages de l'extension.

## Récupération des abonnés

xGhost n'envoie **aucune requête** à X (pas de forge d'en-tête anti-bot). Il ouvre x.com et lit les
réponses que la page reçoit elle-même.

- **Onglet de scan** ouvert avec le fragment `#xghost` : seul cet onglet est instrumenté. Le script de
  page (monde MAIN) y lit les réponses `Followers`, `UserByScreenName` et `UserByRestId`, et les
  transmet au script isolé par un `MessageChannel` privé, échangé avant tout code de x.com. Les autres
  onglets x.com ne sont pas touchés.
- **Contrôle léger** (« Vérifier maintenant », alarmes) : onglet caché, sans défilement. Total annoncé
  + 50 premiers abonnés → arrivées, départs récents (comparés à l'ordre enregistré), écart restant.
  Total X en retard : nouvelle vérification 10 min plus tard.
- **Scan complet** (écart inexpliqué, « Scan complet », référence, contrôle tous les 10 contrôles
  légers) : onglet épinglé en arrière-plan avec overlay. S'arrête dès que les départs annoncés sont
  trouvés quand il est déclenché par un écart.
- **Couverture** : complet à 99 % du total X. Un scan incomplet n'est jamais comparé ; ses abonnés sont
  gardés pour « Continuer le scan ».
- **Limite de X** (429, erreur 88, `x-rate-limit-remaining: 0`) : pause jusqu'à l'heure annoncée, puis
  reprise automatique.

## Choix appliqués

1. Un départ est « vu » dès qu'il est affiché ; il garde l'étiquette « Nouveau » jusqu'à ce qu'on
   quitte la page.
2. « Suivre aussi mes abonnements » est affiché désactivé (« bientôt disponible »), reporté en v2.
3. Une notification groupée par vérification.
4. Historique illimité : 500 événements max par compte en sync (moins si le quota l'impose), le reste
   en archive locale.
5. Les réglages sont globaux, sauf « Uniquement les mutuels », propre à chaque compte.
6. Le statut des comptes partis (suspendu, supprimé) n'est pas vérifié : xGhost n'ouvre jamais leur
   profil.

Le bloc « Données » (export CSV, « Refaire le scan initial ») n'est pas implémenté.
