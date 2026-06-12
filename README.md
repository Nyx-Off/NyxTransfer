# 🌙 NyxTransfer

> Partage de fichiers et de messages chiffrés de bout en bout — zero-knowledge, sans compte, sans base de données.

NyxTransfer chiffre vos fichiers et vos messages **directement dans le navigateur** (AES-256-GCM via la Web Crypto API) avant le moindre envoi. Le serveur ne reçoit que des octets chiffrés : ni nom de fichier, ni type, ni contenu. La clé de déchiffrement voyage dans le fragment `#` de l'URL — qui, par conception du protocole HTTP, n'est **jamais transmis au serveur**.

## ✨ Fonctionnalités

- 🔐 **Chiffrement de bout en bout** — AES-256-GCM, clé générée localement, jamais envoyée au serveur
- 📦 **Fichiers jusqu'à 15 Go** — chiffrement en streaming et envoi par chunks de 5 Mo (compatible avec les limites PHP des hébergements mutualisés)
- 💬 **Messages chiffrés** — mots de passe, notes confidentielles, jusqu'à 50 000 caractères
- ⏱️ **Expiration automatique** — 1 heure, 1 jour, 7 jours ou 30 jours
- 🔥 **Autodestruction** — nombre maximal de téléchargements/consultations configurable (ex. lecture unique)
- 🚫 **Aucun compte, aucune base de données** — stockage sur fichiers, zéro dépendance externe (ni Composer, ni npm)
- 🛡️ **Rate limiting par IP** et nettoyage automatique des transferts expirés

## 🧠 Modèle zero-knowledge

1. Le navigateur génère une clé AES-256 aléatoire (`crypto.subtle.generateKey`).
2. Les fichiers sont chiffrés localement par blocs de 4 Mo (format conteneur NYXS, voir plus bas).
3. Les octets chiffrés sont envoyés au serveur par chunks de 5 Mo.
4. Le lien de partage est généré :

   ```
   https://exemple.com/d.php?id=Xy12abCD#CLE_BASE64URL
   ```

   La clé se trouve après le `#` : le navigateur ne l'envoie jamais dans la requête HTTP.
5. Le destinataire télécharge le blob chiffré et le déchiffre localement, dans son navigateur.

Le serveur ne connaît que : un identifiant aléatoire, une taille en octets, des horodatages et des compteurs. Rien d'autre.

### Format du conteneur (NYXS v2)

Chaque transfert de fichiers est un flux binaire unique :

| Section | Contenu |
|---|---|
| En-tête (16 o) | magic `NYXS`, version, taille de bloc (4 Mo), nombre de blocs |
| Bloc 0 | manifeste JSON chiffré (noms, tailles, types des fichiers) |
| Blocs 1…N | données des fichiers, concaténées puis découpées en blocs de 4 Mo |

Chaque bloc chiffré = `IV (12 o) + longueur (4 o) + ciphertext + tag GCM (16 o)`, avec l'index du bloc en données additionnelles (AAD) pour empêcher toute réorganisation ou troncature silencieuse du flux.

Les métadonnées des fichiers (noms, types) étant dans le manifeste chiffré, le serveur n'y a jamais accès.

## 🚀 Installation

### Prérequis

- PHP ≥ 7.4 (8.x recommandé) — aucune extension exotique requise
- Apache avec `mod_rewrite` et `mod_headers` (ou nginx, voir plus bas)
- **HTTPS obligatoire** : la Web Crypto API n'est disponible qu'en contexte sécurisé (ou sur `localhost`)

### Déploiement

1. Copiez les fichiers du dépôt dans un répertoire servi par votre serveur web.
2. Vérifiez que PHP peut écrire dans `storage/` et `data/` (créés automatiquement au premier appel si absents).
3. Ajoutez une tâche cron pour le nettoyage des transferts expirés :

   ```cron
   0 * * * * php /chemin/vers/nyxtransfer/cleanup.php
   ```

   Un nettoyage opportuniste s'exécute aussi sur ~2 % des requêtes API, le cron est donc un filet de sécurité.

C'est tout. Pas de build, pas de migration, pas de configuration obligatoire.

> **Important :** `storage/` et `data/` contiennent les blobs chiffrés et les métadonnées. Leur accès HTTP direct est bloqué par les `.htaccess` fournis ainsi que par une règle dans le `.htaccess` racine. Si vous n'utilisez pas Apache, reproduisez ce blocage (voir nginx ci-dessous).

### Exemple nginx

```nginx
location ~ ^/(storage|data)(/|$) { deny all; }

# Jolies URLs (optionnel)
rewrite ^/t/([a-zA-Z0-9_-]+)/?$ /d.php?id=$1 last;
rewrite ^/m/([a-zA-Z0-9_-]+)/?$ /m.php?id=$1 last;
```

### Configuration

Les limites se règlent en tête de `api/config.php` :

| Constante | Défaut | Rôle |
|---|---|---|
| `MAX_SIZE` | 16 Go | Taille max d'un blob chiffré (15 Go utiles + surcoût crypto) |
| `MAX_CHUNK_SIZE` | 12 Mo | Taille max d'un chunk reçu (le client envoie 5 Mo) |
| `MAX_UPLOAD_TIME` | 3 h | Délai max pour terminer un envoi |
| `RATE_LIMIT_INIT` | 30/h | Créations de transferts par IP et par heure |
| `CLEANUP_BATCH` | 200 | Fichiers traités max par passe de nettoyage |

La limite affichée côté client se règle dans `index.php` (`$maxUploadSize`).

Les chunks de 5 Mo passent sous les limites PHP par défaut (`post_max_size`) : l'envoi de fichiers volumineux fonctionne même sur un hébergement mutualisé restrictif.

## 📡 API

| Endpoint | Méthode | Rôle |
|---|---|---|
| `api/upload.php?action=init` | POST | Crée un transfert, renvoie `id` + `token` d'upload |
| `api/upload.php?action=chunk` | POST | Reçoit un chunk binaire (authentifié par token) |
| `api/upload.php?action=finalize` | POST | Vérifie la taille et publie le transfert |
| `api/upload.php?action=abort` | POST | Annule et supprime un envoi en cours |
| `api/info.php?id=…` | GET | Métadonnées non sensibles d'un transfert |
| `api/download.php?id=…` | GET | Sert le blob chiffré (compteur atomique via `flock`) |
| `api/message.php?action=create` | POST | Stocke un message chiffré |
| `api/message.php?action=info` | GET | Métadonnées d'un message |
| `api/message.php?action=fetch` | GET | Renvoie le message chiffré (compteur atomique) |

L'upload est protégé par un token éphémère (stocké hashé en SHA-256, supprimé à la finalisation). Les compteurs de téléchargements/consultations sont incrémentés sous verrou exclusif : la limite est respectée même en cas d'accès concurrents.

## 📁 Structure

```
nyxtransfer/
├── index.php          # Page principale (onglets Fichiers / Message)
├── d.php              # Page de téléchargement (déchiffrement local)
├── m.php              # Page de lecture d'un message
├── msg.php            # Page d'envoi de message (accès direct)
├── cleanup.php        # Script de nettoyage (cron)
├── api/
│   ├── config.php     # Config, helpers, rate limit, nettoyage
│   ├── upload.php     # init / chunk / finalize / abort
│   ├── download.php   # Streaming du blob chiffré
│   ├── info.php       # Métadonnées d'un transfert
│   └── message.php    # create / info / fetch des messages
├── assets/
│   ├── css/style.css
│   └── js/            # app.js, download.js, message.js, msg-send.js
├── storage/           # Blobs chiffrés (.bin) — accès HTTP bloqué
└── data/              # Métadonnées JSON + verrous — accès HTTP bloqué
```

## ⚠️ Limites du modèle

Comme toute application de chiffrement « dans le navigateur », le code JavaScript est livré par le serveur à chaque visite. Un serveur compromis ou malveillant pourrait servir un script modifié qui exfiltre la clé. Le modèle zero-knowledge protège contre un serveur **honnête mais curieux** (et contre la fuite des données stockées), pas contre un opérateur activement hostile. Pour des données critiques, chiffrez également vos fichiers en amont (age, GPG, 7z AES…).

Ce projet n'a pas fait l'objet d'un audit de sécurité indépendant.

## 📄 Licence

[MIT](LICENSE)
