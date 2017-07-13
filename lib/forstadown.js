/* global module */

(function() {
    "use strict";

    const root = this;
    const ns = {};

    if (typeof module !== 'undefined' && module.exports) {
        /* Running in nodejs */
        module.exports = ns;
    } else {
        /* Running in browser */
        root.forstadown = ns;
    }

    const fdExpressions = [{
        tag: 'a',
        stop_on_match: true,
        match: /((https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_+.~#?&//=]*)))(">(.*)<\/a>)?/ig,
        sub: '<a href="$1">$1</a>',
        parent_blacklist: ['a']
    }, {
        tag: 'samp',
        match: /`(\S.*?\S|\S)`/g
    }, {
        tag: 'mark',
        match: /=(\S.*?\S|\S)=/g
    }, {
        tag: 'ins',
        match: /\+(\S.*?\S|\S)\+/g
    }, {
        tag: 'strong',
        match: /\*(\S.*?\S|\S)\*/g
    }, {
        tag: 'del',
        match: /~(\S.*?\S|\S)~/g
    }, {
        tag: 'u',
        match: /__(\S.*?\S|\S)__/g
    }, {
        tag: 'em',
        match: /_(\S.*?\S|\S)_/g
    }, {
        tag: 'sup',
        match: /\^(\S.*?\S|\S)\^/g
    }, {
        tag: 'sub',
        match: /\?(\S.*?\S|\S)\?/g
    }, {
        tag: 'blink',
        match: /!(\S.*?\S|\S)!/g
    }, {
        tag: 'h1',
        match: /#{3}(.*?|\S)#{3}/gm
    }, {
        tag: 'h3',
        match: /#{2}(.*?|\S)#{2}/gm
    }, {
        tag: 'h5',
        match: /#{1}(.*?|\S)#{1}/gm
    }];
  
    ns.blockConvert = function(html) {
        let open = false;
        return html.split(/(```)/).map(x => {
            if (x === '```') {
                open = !open;
                return open ? '<code>' : '</code>';
            } else {
                return x;
            }
        }).join('');
    };

    ns.inlineConvert = function(text, parents) {
        /* Do all the inline ones now */
        if (parents.has('code')) {
            return text;
        }
        let val = text;
        for (const expr of fdExpressions) {
            if (val.match(expr.match)) {
                if (expr.parent_blacklist &&
                    !!expr.parent_blacklist.filter(x => parents.has(x)).length) {
                    if (expr.stop_on_match) {
                        break;
                    } else {
                        continue;
                    }
                }
                const sub = expr.sub || `<${expr.tag}>$1</${expr.tag}>`;
                val = val.replace(expr.replace || expr.match, sub);
                if (expr.stop_on_match) {
                    break;
                }
            }
        }
        return val;
    };
}).call(this);