// vim: ts=4:sw=4:expandtab
/* global Raven, DOMPurify, forstadown, md5, relay, ga */

(function () {
    'use strict';

    self.F = self.F || {};
    const ns = F.util = {};

    F.urls = {
        main: '/@',
        login: '/login',
        logout: '/logout',
        static: '/@static/',
        install: '/@install',
        register: '/@register',
        templates: '/@static/templates/',
        worker_service: '/@worker-service.js',
        worker_shared: '/@worker-shared.js'
    };

    ns.theme_colors = {
        red: '#db2828',
        deep_red: '#851313',
        orange: '#fa7d20',
        yellow: '#fbbd08',
        olive: '#b5cc18',
        green: '#21ba45',
        light_green: '#6dcb84',
        dark_green: '#284d14',
        teal: '#00b5ad',
        blue: '#2185d0',
        light_blue: '#4b84bc',
        dark_blue: '#074483',
        violet: '#6435c9',
        pink: '#e03997',
        brown: '#a5673f',
        grey: '#767676',
        black: '#3a3b3d'
    };

    function targetBlankHook(node) {
        if ('target' in node) {
            node.setAttribute('target', '_blank');
        }
    }

    function makeFrag(html) {
        const frag = document.createDocumentFragment();
        const transfer = document.createElement('div');
        transfer.innerHTML = html;
        const nodes = transfer.childNodes;
        while (nodes.length) {
            const node = nodes[0];
            node._forsta_mark = true;
            frag.appendChild(node);
        }
        return frag;
    }

    function parentNodes(node) {
        const parents = [];
        let ptr = node.parentNode;
        while (ptr) {
            parents.push(ptr);
            ptr = ptr.parentNode;
        }
        return parents;
    }

    let viewDOMPurify;
    let fdDOMPurify;
    if (self.DOMPurify) {
        viewDOMPurify = DOMPurify(self);
        fdDOMPurify = DOMPurify(self);

        viewDOMPurify.addHook('afterSanitizeAttributes', targetBlankHook);
        fdDOMPurify.addHook('afterSanitizeAttributes', targetBlankHook);
        fdDOMPurify.addHook('afterSanitizeElements', node => {
            if(node.nodeName === '#text' && !node._forsta_mark) {
                const parentTags = new Set(parentNodes(node).map(x => x.nodeName.toLowerCase()));
                const convertedVal = forstadown.inlineConvert(node.nodeValue, parentTags);
                if (convertedVal !== node.nodeValue) {
                    node.parentElement.replaceChild(makeFrag(convertedVal), node);
                }
            }
        });
        fdDOMPurify.addHook('afterSanitizeElements', node => {
            /* Cleanup mess left by our crufty code tag insertion */
            if (node.nodeName === 'CODE' && node.childNodes.length === 0) {
                node.parentNode.removeChild(node);
            }
        });
    }

    const _issueEventHandlers = {};
    const _issueEventQueues = {};
    function initIssueReporting() {
        /* There are restrictions on when some event handlers can register in service
         * workers. Also, we'd like to capture any errors that happen early in the
         * start process if possible.
         */
        for (const eventName of ['error', 'unhandledrejection']) {
            const q = _issueEventQueues[eventName] = [];
            addEventListener(eventName, ev => {
                const handler = _issueEventHandlers[eventName];
                if (handler) {
                    handler(ev);
                } else {
                    console.warn("Enqueing early issue event:", eventName, ev);
                    q.push(ev);
                }
            });
        }
    }

    function addIssueHandler(eventName, handler) {
        const q = _issueEventQueues[eventName];
        for (const ev of q) {
            try {
                console.info("Dequeing early issue event:", eventName, ev);
                handler(ev);
            } catch(e) {
                console.error(e);
            }
        }
        q.length = 0;
        _issueEventHandlers[eventName] = handler;
    }

    let _issueReportingEnabled;
    ns.startIssueReporting = async function() {
        // Sends exception data to https://sentry.io and get optional user feedback.
        _issueReportingEnabled = !(await F.state.get('disableBugReporting'));
        if (_issueReportingEnabled && F.env.SENTRY_DSN && self.Raven) {
            Raven.config(F.env.SENTRY_DSN, {
                release: F.env.GIT_COMMIT,
                serverName: F.env.SERVER_HOSTNAME,
                environment: F.env.STACK_ENV || 'dev',
                tags: {
                    version: F.version
                }
            }).install();
            if (F.env.SENTRY_USER_ERROR_FORM) {
                addIssueHandler('error', () => {
                    if (_issueReportingEnabled) {
                        Raven.showReportDialog();
                    }
                });
            }
            /* For promise based exceptions... */
            addIssueHandler('unhandledrejection', ev => {
                if (_issueReportingEnabled) {
                    const exc = ev.reason;  // This is the actual error instance.
                    Raven.captureException(exc, {tags: {async: true}});
                    if (F.env.SENTRY_USER_ERROR_FORM) {
                        Raven.showReportDialog();
                    }
                }
            });
        }
    };

    ns.stopIssueReporting = function() {
        _issueReportingEnabled = false;
        Raven.uninstall();
    };

    ns.setIssueReportingContext = function(context) {
        self.Raven && Raven.setUserContext(context);
    };

    ns.reportIssue = function(level, msg, extra) {
        const logFunc = {
            warning: console.warn,
            error: console.error,
            info: console.info
        }[level] || console.log;
        logFunc(msg, extra);
        if (_issueReportingEnabled && self.Raven) {
            Raven.captureMessage(msg, {
                level,
                extra
            });
        }
    };

    ns.reportError = function(msg, extra) {
        ns.reportIssue('error', msg, extra);
    };

    ns.reportWarning = function(msg, extra) {
        ns.reportIssue('warning', msg, extra);
    };

    ns.reportInfo = function(msg, extra) {
        ns.reportIssue('info', msg, extra);
    };

    let _usageReportingEnabled;
    ns.startUsageReporting = async function() {
        _usageReportingEnabled = !(await F.state.get('disableUsageReporting')) &&
                                 !!F.env.GOOGLE_ANALYTICS_UA;
        if (_usageReportingEnabled) {
            ga('create', F.env.GOOGLE_ANALYTICS_UA, 'auto');
            ga('set', 'anonymizeIp', true);
            ga('set', 'userId', md5(F.currentUser.id));
            ga('send', 'pageview');
        }
    };

    ns.stopUsageReporting = function() {
        if (_usageReportingEnabled) {
            _usageReportingEnabled = false;
            ga('remove');
        }
    };

    ns.reportUsageCommand = function() {
        if (_usageReportingEnabled) {
            ga.apply(self, arguments);
        }
    };

    ns.reportUsageEvent = function() {
        const args = ['send', 'event'].concat(Array.from(arguments));
        ns.reportUsageCommand.apply(this, args);
    };

    ns.htmlSanitize = function(dirty_html_str, render_forstadown) {
        if (!dirty_html_str) {
            return dirty_html_str;
        }
        const purify = render_forstadown ? fdDOMPurify : viewDOMPurify;
        if (render_forstadown) {
            dirty_html_str = forstadown.blockConvert(dirty_html_str);
        }
        return purify.sanitize('<force/>' + dirty_html_str, {
            ALLOW_ARIA_ATTR: false,
            ALLOW_DATA_ATTR: false,
            ALLOWED_TAGS: ['p', 'b', 'i', 'u', 'del', 'pre', 'code', 'br', 'hr',
                           'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                           'em', 'time', 'mark', 'blockquote', 'ul', 'ol', 'li',
                           'dd', 'dl', 'dt', 'a', 'abbr', 'cite', 'dfn', 'q',
                           'kbd', 'samp', 'small', 's', 'ins', 'strong', 'sub',
                           'sup', 'var', 'wbr', 'audio', 'img', 'video', 'source',
                           'blink'],
            ALLOWED_ATTR: ['src', 'type', 'controls', 'title', 'alt', 'checked',
                           'cite', 'color', 'background', 'border', 'bgcolor',
                           'autocomplete', 'align', 'action', 'accept', 'href',
                           'datetime', 'default', 'dir', 'disabled', 'face',
                           'for', 'headers', 'height', 'width', 'hidden', 'label',
                           'lang', 'max', 'maxlength', 'multiple', 'min',
                           'placeholder', 'readonly', 'role', 'spellcheck',
                           'selected', 'start', 'step', 'summary', 'value',
                           'controls', 'loop', 'autoplay', 'muted', 'poster',
                           'preload', 'disableRemotePlayback', 'playsinline', 'f-type']
        });
    };

    ns.uuid4 = function() {
        return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
    };

    /* Extend the builtin Set type with intersection methods. */
    ns.ESet = class ESet extends Set {
        isSuperset(subset) {
            for (const elem of subset) {
                if (!this.has(elem)) {
                    return false;
                }
            }
            return true;
        }

        union(setB) {
            const union = new ESet(this);
            for (const elem of setB) {
                union.add(elem);
            }
            return union;
        }

        intersection(setB) {
            const intersection = new ESet();
            for (const elem of setB) {
                if (this.has(elem)) {
                    intersection.add(elem);
                }
            }
            return intersection;
        }

        difference(setB) {
            const difference = new ESet(this);
            for (const elem of setB) {
                difference.delete(elem);
            }
            return difference;
        }

        equals(setB) {
            return this.size === setB.size && !this.difference(setB).size;
        }
    };

    ns.urlQuery = function(args) {
        /* Convert the args object to a url query string or empty string. */
        if (!args) {
            return '';
        }
        const pruned = Object.entries(args).filter(([_, val]) => val !== undefined);
        if (!pruned.length) {
            return '';
        }
        const encoded = pruned.map(tuple => tuple.map(encodeURIComponent).join('='));
        return '?' + encoded.join('&');
    };

    ns.blobToDataURL = async function(blob) {
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener('load', () => resolve(reader.result));
            reader.addEventListener('error', reject);
            reader.readAsDataURL(blob);
        });
    };

    ns.gravatarURL = F.cache.ttl(86400, async function util_gravatarBlob(hash, options) {
        const args = Object.assign({
            size: 256,
            rating: 'pg',
            _dc: Math.floor(Date.now() / 86400000) // Bust gravatar caches once a day.
        }, options);
        args.default = 404;
        const q = ns.urlQuery(args);
        const resp = await fetch(`https://www.gravatar.com/avatar/${hash}${q}`);
        if (!resp.ok) {
            if (resp.status !== 404) {
                throw new Error(await resp.text());
            } else {
                return;
            }
        }
        return await ns.blobToDataURL(await resp.blob());
    });

    let _fontURL;
    const _textAvatarURL = F.cache.ttl(86400, async function util_textAvatarURL(text, bgColor, fgColor, size) {
        bgColor = bgColor || ns.pickColor(text);
        bgColor = ns.theme_colors[bgColor] || bgColor;
        fgColor = fgColor || 'white';
        fgColor = ns.theme_colors[fgColor] || fgColor;
        size = size || 448;
        if (!_fontURL) {
            const fontResp = await ns.fetchStatic('fonts/Poppins-Medium.ttf');
            _fontURL = await ns.blobToDataURL(await fontResp.blob());
        }
        const svg = [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`,
                `<defs>`,
                    `<style type="text/css">`,
                        `@font-face {`,
                            `font-family: 'ForstaAvatar';`,
                            `src: url(${_fontURL}) format('truetype');`,
                        `}`,
                    `</style>`,
                `</defs>`,
                `<rect width="${size}" height="${size}" fill="${bgColor}"/>`,
                `<text text-anchor="middle" fill="${fgColor}" font-size="${size / 2}" x="${size / 2}" y="${size / 2}" `,
                      `font-family="ForstaAvatar" dominant-baseline="central">`,
                    text,
                '</text>',
            '</svg>'
        ];
        const img = new Image();
        const getPngUrl = new Promise((resolve, reject) => {
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.height = canvas.width = size;
                try {
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    resolve(canvas.toDataURL('image/png'));
                } catch(e) {
                    reject(e);
                }
            };
            img.onerror = reject;
        });
        img.src = URL.createObjectURL(new Blob(svg, {type: 'image/svg+xml'}));
        try {
            return await getPngUrl;
        } finally {
            URL.revokeObjectURL(img.src);
        }
    });

    ns.textAvatarURL = async function() {
        if (!self.Image) {
            /* Probably a service worker. */
            return ns.versionedURL(F.urls.static + 'images/simple_user_avatar.png');
        } else {
            return await _textAvatarURL.apply(this, arguments);
        }
    };

    ns.pickColor = function(hashable) {
        const intHash = parseInt(md5(hashable).substr(0, 10), 16);
        const colors = Object.keys(ns.theme_colors);
        return colors[intHash % colors.length];
    };

    ns.confirmModal = async function(options) {
        let view;
        const p = new Promise((resolve, reject) => {
            const actions = [];
            if (options.dismiss !== false) {
                actions.push({
                    class: 'deny ' + (options.dismissClass || ''),
                    label: options.dismissLabel || 'Dismiss',
                    icon: options.dismissIcon
                });
            }
            if (options.confirm !== false) {
                actions.push({
                    class: 'approve ' + (options.confirmClass || 'primary'),
                    label: options.confirmLabel || 'Confirm',
                    icon: options.confirmIcon
                });
            }
            view = new F.ModalView({
                header: options.header,
                content: options.content,
                footer: options.footer,
                size: options.size,
                icon: options.icon || 'help circle',
                actions,
                options: {
                    onApprove: () => resolve(true),
                    onDeny: () => resolve(false),
                    onHide: () => resolve(undefined),
                    closable: options.closable,
                    allowMultiple: options.allowMultiple,
                }
            });
        });
        await view.show();
        return await p;
    };

    ns.promptModal = async function(options) {
        let view;
        const p = new Promise(resolve => {
            view = new F.ModalView({
                header: options.header,
                content: options.content,
                footer: options.footer,
                size: options.size,
                icon: options.icon || 'info circle',
                actions: [{
                    class: options.dismissClass || 'approve',
                    label: options.dismissLabel || 'Dismiss',
                    icon: options.dismissIcon
                }],
                options: {
                    onApprove: () => resolve(true),
                    onHide: () => resolve(undefined)
                }
            });
        });
        await view.show();
        return await p;
    };

    ns.isSmallScreen = function() {
        // Make max-width matches stylesheets/main.scss @media for small screen
        return matchMedia('(max-width: 768px)').matches;
    };

    ns.isTouchDevice = function() {
        return !!('ontouchstart' in self || navigator.maxTouchPoints);
    };

    ns.isCoarsePointer = function() {
        // This is a useful way to detect if the device doesn't have a real mouse.
        return matchMedia('(pointer: coarse)').matches;
    };

    if (self.jQuery && ns.isCoarsePointer()) {
        // We need to leave a breadcrumb for lesser browsers like gecko.
        // See: https://bugzilla.mozilla.org/show_bug.cgi?id=1035774
        $('html').addClass('f-coarse-pointer');
    }

    const _AudioCtx = self.AudioContext || self.webkitAudioContext;
    const _audioCtx = _AudioCtx && new _AudioCtx();
    const _audioBufferCache = new Map();

    const _getAudioArrayBuffer = F.cache.ttl(86400 * 7, (async function _getAudioClip(url) {
        const file = await ns.fetchStatic(url);
        return await file.arrayBuffer();
    }));

    ns.playAudio = async function(url) {
        if (!_audioCtx) {
            console.warn("Audio not supported");
            return;
        }
        const source = _audioCtx.createBufferSource();
        if (!_audioBufferCache.has(url)) {
            // Always use copy of the arraybuffer as it gets detached.
            const ab = (await _getAudioArrayBuffer(url)).slice(0);
            const buf = await new Promise(resolve => {
                _audioCtx.decodeAudioData(ab, resolve);
            });
            _audioBufferCache.set(url, buf);
        }
        source.buffer = _audioBufferCache.get(url);
        source.connect(_audioCtx.destination);
        source.start(0);
    };

    ns.versionedURL = function(url) {
        url = url.trim();
        url += ((url.match(/\?/)) ? '&' : '?');
        url += 'v=' + F.env.GIT_COMMIT.substring(0, 8);
        return url;
    };

    ns.fetchStatic = async function(urn, options) {
        urn = ns.versionedURL(urn);
        return await fetch(F.urls.static + urn.replace(/^\//, ''), options);
    };

    ns.resetRegistration = async function() {
        console.warn("Clearing registration state");
        await F.state.put('registered', false);
        location.reload(); // Let auto-provision have another go.
        // location.reload is async, prevent further execution...
        await relay.util.never();
    };

    ns.makeInvalidUser = function(label) {
        const user = new F.User({
            id: null,
            first_name: 'Invalid User',
            last_name: `(${label})`,
            email: 'support@forsta.io',
            gravatar_hash: 'ec055ce3445bb52d3e972f8447b07a68',
            tag: {
                id: null
            }
        });
        user.getColor = () => 'red';
        user.getAvatarURL = () => ns.textAvatarURL('⚠', user.getColor());
        return user;
    };

    ns.idbRequest = async function(req) {
        /* Convert IDBRequest object into a promise */
        return await new Promise((resolve, reject) => {
            req.onsuccess = ev => resolve(ev.target.result);
            req.onerror = ev => reject(new Error(ev.target.errorCode));
        });
    };

    ns.waitTillOnline = async function(timeout) {
        if (navigator.onLine) {
            return;
        }
        await new Promise(resolve => {
            let timeoutId;
            const singleResolve = () => {
                resolve(navigator.onLine);
                removeEventListener('online', singleResolve);
                clearTimeout(timeoutId);
            };
            addEventListener('online', singleResolve);
            if (timeout) {
                timeoutId = setTimeout(singleResolve, timeout * 1000);
            }
        });
    };

    ns.waitTillVisible = async function(timeout) {
        if (!document.hidden) {
            return;
        }
        await new Promise(resolve => {
            let timeoutId;
            const singleResolve = (ev, isTimeout) => {
                const visible = !document.hidden;
                if (visible || isTimeout) {
                    resolve(visible);
                    document.removeEventListener('visibilitychange', singleResolve);
                    clearTimeout(timeoutId);
                }
            };
            document.addEventListener('visibilitychange', singleResolve);
            if (timeout) {
                setTimeout(singleResolve, timeout * 1000, null, /*isTimeout*/ true);
            }
        });
    };

    ns.showUserCard = async function(id, $avatarSource) {
        const view = new F.View();
        const user = (await F.atlas.getContacts([id]))[0];
        if (!user) {
            console.warn("User not found: card broken");
            return; // XXX Could probably just tell the user something...
        }
        if ($avatarSource && $avatarSource.length > 1) {
            throw TypeError("Avatar source can only have one element!");
        }
        if (!F.util.isSmallScreen() && $avatarSource) {
            await view._showUserPopup($avatarSource, user);
        } else {
            await view._showUserModal(user);
        }
    };

    initIssueReporting();
})();
