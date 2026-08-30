/*!
 * Kotlin.js — run a subset of Kotlin syntax directly in the browser.
 * https://github.com/asnlx/kotlin-js
 *
 * Usage:
 *   <script src="kotlin.js"></script>
 *   <script type="text/kotlin">
 *       fun main() {
 *           val name = "World"
 *           println("Hello, $name!")
 *       }
 *   </script>
 *
 * (c) 2026 — ISC License
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KotlinJS = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------

  // Splits `str` on newlines that occur at bracket-depth 0 (i.e. not
  // inside (), [] or {}), returning an array of top-level lines/chunks.
  function splitTopLevel(str) {
    var chunks = [];
    var depth = 0;
    var current = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      if (ch === ')' || ch === ']' || ch === '}') depth--;
      if (ch === '\n' && depth <= 0) {
        chunks.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim().length) chunks.push(current);
    return chunks;
  }

  // Finds the index of the matching closing brace for the `{` at openIdx.
  function findMatchingBrace(str, openIdx) {
    var depth = 0;
    for (var i = openIdx; i < str.length; i++) {
      if (str[i] === '{') depth++;
      else if (str[i] === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  // Finds the index of the matching closing paren for the `(` at openIdx.
  function findMatchingParen(str, openIdx) {
    var depth = 0;
    for (var i = openIdx; i < str.length; i++) {
      if (str[i] === '(') depth++;
      else if (str[i] === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  // ---------------------------------------------------------------------
  // Step 1: protect string / char literals so later transforms never
  // touch their contents. Also converts Kotlin string templates
  // ("text $x ${expr}") into JS template literals (`text ${x} ${expr}`).
  // ---------------------------------------------------------------------
  function protectStrings(code) {
    var vault = [];

    function stash(jsLiteral) {
      var token = '\u0001STR' + vault.length + '\u0001';
      vault.push(jsLiteral);
      return token;
    }

    function lightExprFix(expr) {
      // small conveniences inside ${...} interpolations
      return expr.replace(/\.size\b(?!\()/g, '.length');
    }

    function templatize(inner) {
      // "${expr}" stays as-is; bare "$name" becomes "${name}"
      return inner.replace(/\$\{([^}]*)\}/g, function (m, expr) {
        return '\u0002EXPR' + vault.push('${' + lightExprFix(expr) + '}') + '\u0002';
      }).replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, '${$1}')
        .replace(/\u0002EXPR(\d+)\u0002/g, function (m, n) {
          return vault[parseInt(n, 10) - 1];
        });
    }

    var out = '';
    var i = 0;
    while (i < code.length) {
      var ch = code[i];

      // triple-quoted raw string """..."""
      if (code.substr(i, 3) === '"""') {
        var end = code.indexOf('"""', i + 3);
        if (end === -1) end = code.length;
        var inner = code.slice(i + 3, end);
        var jsInner = templatize(inner).replace(/`/g, '\\`');
        out += stash('`' + jsInner + '`');
        i = end + 3;
        continue;
      }

      // regular double-quoted string "..."
      if (ch === '"') {
        var j = i + 1;
        var buf = '';
        while (j < code.length && code[j] !== '"') {
          if (code[j] === '\\') { buf += code[j] + code[j + 1]; j += 2; continue; }
          buf += code[j];
          j++;
        }
        var jsInner2 = templatize(buf).replace(/`/g, '\\`');
        out += stash('`' + jsInner2 + '`');
        i = j + 1;
        continue;
      }

      // char literal 'x'
      if (ch === "'") {
        var k = i + 1;
        var cbuf = '';
        while (k < code.length && code[k] !== "'") {
          if (code[k] === '\\') { cbuf += code[k] + code[k + 1]; k += 2; continue; }
          cbuf += code[k];
          k++;
        }
        out += stash("'" + cbuf + "'");
        i = k + 1;
        continue;
      }

      out += ch;
      i++;
    }

    return { code: out, vault: vault };
  }

  function restoreStrings(code, vault) {
    return code.replace(/\u0001STR(\d+)\u0001/g, function (m, n) {
      return vault[parseInt(n, 10)];
    });
  }

  // ---------------------------------------------------------------------
  // Step 2: strip line & block comments (safe: strings are already
  // protected as tokens, so // or /* inside a string literal is untouched)
  // ---------------------------------------------------------------------
  function stripComments(code) {
    code = code.replace(/\/\*[\s\S]*?\*\//g, '');
    code = code.replace(/\/\/.*$/gm, '');
    return code;
  }

  // ---------------------------------------------------------------------
  // Step 3: package / import statements are meaningless in a browser
  // <script> — drop them.
  // ---------------------------------------------------------------------
  function stripPackageImports(code) {
    code = code.replace(/^\s*package\s+[\w.]+\s*$/gm, '');
    code = code.replace(/^\s*import\s+[\w.*]+(\s+as\s+\w+)?\s*$/gm, '');
    return code;
  }

  // ---------------------------------------------------------------------
  // Step 4: classes (including data classes) with a primary constructor.
  // ---------------------------------------------------------------------
  function stripTypeAnnotation(param) {
    // "name: Type = default"  ->  "name = default"
    // "name: Type"            ->  "name"
    var m = param.match(/^\s*(?:val\s+|var\s+)?([A-Za-z_][\w]*)\s*:\s*[^=]+(=\s*[\s\S]+)?$/);
    if (!m) return param.trim();
    return m[2] ? (m[1] + ' ' + m[2]) : m[1];
  }

  function transpileClasses(code, classNames) {
    classNames = classNames || [];
    var classRe = /(data\s+)?class\s+([A-Za-z_]\w*)\s*(\(([^)]*)\))?\s*(:\s*([A-Za-z_][\w.]*)\s*(\([^)]*\))?)?\s*\{/;
    var out = code;
    var guard = 0;
    while (true) {
      var m = classRe.exec(out);
      if (!m || guard++ > 200) break;
      var isData = !!m[1];
      var name = m[2];
      classNames.push(name);
      var rawParams = m[4] || '';
      var parentName = m[6];
      var openBraceIdx = m.index + m[0].length - 1;
      var closeBraceIdx = findMatchingBrace(out, openBraceIdx);
      if (closeBraceIdx === -1) break;
      var body = out.slice(openBraceIdx + 1, closeBraceIdx);
      // Methods inside the class body: `fun greet() { ... }` becomes plain
      // ES6 method shorthand `greet() { ... }`, not a `function` declaration
      // (which is invalid directly inside a class body).
      body = transpileFunctions(body).replace(/\bfunction\s+/g, '');

      var params = rawParams.trim().length
        ? rawParams.split(',').map(function (p) { return p.trim(); })
        : [];
      var ctorFields = params.map(function (p) {
        var isProp = /^(val|var)\s+/.test(p);
        var cleaned = stripTypeAnnotation(p);
        var pname = cleaned.split('=')[0].trim();
        return { raw: cleaned, name: pname, isProp: isProp };
      });

      var ctorArgs = ctorFields.map(function (f) { return f.raw; }).join(', ');
      // data classes without explicit val/var still expose all fields
      var propFields = isData ? ctorFields : ctorFields.filter(function (f) { return f.isProp; });
      var assigns = propFields
        .map(function (f) { return '    this.' + f.name + ' = ' + f.name + ';'; })
        .join('\n');

      // Inside method bodies, Kotlin lets you reference a property bare
      // (`name`) instead of `this.name`. Rewrite those references so the
      // generated JS methods can actually see the field.
      propFields.forEach(function (f) {
        var propRe = new RegExp('(?<!\\.)\\b' + f.name + '\\b', 'g');
        body = body.replace(propRe, 'this.' + f.name);
      });

      var extendsClause = parentName ? (' extends ' + parentName) : '';
      var superCall = parentName ? '    super();\n' : '';

      var toStringMethod = '';
      if (isData) {
        var fieldList = ctorFields.map(function (f) {
          return f.name + ': \' + JSON.stringify(this.' + f.name + ') + \'';
        }).join(', ');
        // Note: the class name and the opening paren are kept as separate
        // concatenated string literals (`'Name' + '('`) rather than one
        // `'Name('` literal, so the later new-call rewrite pass can't
        // mistake this generated text for an actual constructor call.
        toStringMethod = '\n  toString() {\n    return \'' + name + '\' + \'(' + fieldList + ')\';\n  }\n';
      }

      // Use a placeholder instead of the literal "class" keyword so this
      // freshly-generated JS class body (which itself contains `{`) is
      // never re-matched by classRe on the next loop iteration.
      var replacement =
        '\u0003CLASS\u0003 ' + name + extendsClause + ' {\n' +
        '  constructor(' + ctorArgs + ') {\n' +
        superCall +
        assigns + '\n' +
        '  }\n' +
        toStringMethod +
        body +
        '}';

      out = out.slice(0, m.index) + replacement + out.slice(closeBraceIdx + 1);
    }

    // data class with no body at all: `data class Point(val x: Int, val y: Int)`
    var noBodyRe = /(data\s+)?class\s+([A-Za-z_]\w*)\s*\(([^)]*)\)(?!\s*\{)/;
    guard = 0;
    while (true) {
      var m2 = noBodyRe.exec(out);
      if (!m2 || guard++ > 200) break;
      var full = m2[0] + ' {}';
      out = out.slice(0, m2.index) + full + out.slice(m2.index + m2[0].length);
      // re-run through the braced path
      return transpileClasses(out, classNames);
    }

    out = out.replace(/\u0003CLASS\u0003/g, 'class');
    return { code: out, classNames: classNames };
  }

  // Kotlin doesn't require `new` when constructing an object; JS classes do.
  // Once we know the transpiled class names, rewrite bare call sites.
  function instantiateClasses(code, classNames) {
    var out = code;
    classNames.forEach(function (name) {
      var re = new RegExp('(?<!\\.)(?<!new )\\b' + name + '\\s*\\(', 'g');
      out = out.replace(re, 'new ' + name + '(');
    });
    return out;
  }

  // ---------------------------------------------------------------------
  // Step 5: functions — both block bodies and single-expression bodies.
  // ---------------------------------------------------------------------
  function cleanParamList(raw) {
    if (!raw.trim().length) return '';
    return raw.split(',').map(stripTypeAnnotation).join(', ');
  }

  function transpileFunctions(code) {
    var out = code;

    // fun name(params): Type { ... }   OR   fun name(params) { ... }
    var blockRe = /fun\s+(?:[A-Za-z_][\w.<>]*\.)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(:\s*[\w<>?,.\s\[\]]+)?\s*\{/;
    var guard = 0;
    while (true) {
      var m = blockRe.exec(out);
      if (!m || guard++ > 500) break;
      var name = m[1];
      var params = cleanParamList(m[2]);
      var replacement = 'function ' + name + '(' + params + ') {';
      out = out.slice(0, m.index) + replacement + out.slice(m.index + m[0].length);
    }

    // fun name(params): Type = expression   (single-expression function)
    var exprRe = /fun\s+(?:[A-Za-z_][\w.<>]*\.)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(:\s*[\w<>?,.\s\[\]]+)?\s*=\s*([^\n;]+)/;
    guard = 0;
    while (true) {
      var m2 = exprRe.exec(out);
      if (!m2 || guard++ > 500) break;
      var name2 = m2[1];
      var params2 = cleanParamList(m2[2]);
      var body2 = m2[4].trim();
      var replacement2 = 'function ' + name2 + '(' + params2 + ') { return ' + body2 + '; }';
      out = out.slice(0, m2.index) + replacement2 + out.slice(m2.index + m2[0].length);
    }

    return out;
  }

  // ---------------------------------------------------------------------
  // Step 6: `when` expressions/statements -> IIFE with if/else-if chain.
  // ---------------------------------------------------------------------
  function transpileWhen(code) {
    var out = code;
    var whenRe = /when\s*(\(([^)]*)\))?\s*\{/;
    var guard = 0;
    while (true) {
      var m = whenRe.exec(out);
      if (!m || guard++ > 200) break;
      var subjectExpr = m[2] !== undefined ? m[2].trim() : null;
      var openBraceIdx = m.index + m[0].length - 1;
      var closeBraceIdx = findMatchingBrace(out, openBraceIdx);
      if (closeBraceIdx === -1) break;
      var body = out.slice(openBraceIdx + 1, closeBraceIdx);

      var arms = splitTopLevel(body).map(function (l) { return l.trim(); }).filter(Boolean);
      var subj = subjectExpr ? '__subject' : null;
      var branches = [];
      var elseAction = 'undefined';

      arms.forEach(function (arm) {
        var arrowIdx = arm.indexOf('->');
        if (arrowIdx === -1) return;
        var cond = arm.slice(0, arrowIdx).trim();
        var action = arm.slice(arrowIdx + 2).trim();
        if (action.endsWith(';')) action = action.slice(0, -1);
        var actionExpr = /^\{[\s\S]*\}$/.test(action)
          ? '(() => ' + action + ')()'
          : action;

        if (cond === 'else') {
          elseAction = actionExpr;
          return;
        }

        var jsCond;
        if (!subj) {
          // when without subject: each condition is a boolean expression
          jsCond = cond;
        } else if (/^in\s+/.test(cond)) {
          var rangeExpr = cond.replace(/^in\s+/, '');
          var rangeM = rangeExpr.match(/^(.+?)\.\.(.+)$/);
          if (rangeM) {
            jsCond = '(' + subj + ' >= (' + rangeM[1].trim() + ') && ' + subj + ' <= (' + rangeM[2].trim() + '))';
          } else {
            jsCond = rangeExpr + '.includes(' + subj + ')';
          }
        } else if (/^is\s+/.test(cond)) {
          jsCond = subj + ' instanceof ' + cond.replace(/^is\s+/, '').trim();
        } else if (cond.indexOf(',') !== -1) {
          jsCond = cond.split(',').map(function (c) {
            return subj + ' === (' + c.trim() + ')';
          }).join(' || ');
        } else {
          jsCond = subj + ' === (' + cond + ')';
        }

        branches.push('if (' + jsCond + ') { return ' + actionExpr + '; }');
      });

      var chain = branches.join('\n    else ');
      var iife = '(function () {\n' +
        (subj ? '  var ' + subj + ' = ' + subjectExpr + ';\n' : '') +
        '  ' + chain + '\n' +
        '  return ' + elseAction + ';\n' +
        '})()';

      out = out.slice(0, m.index) + iife + out.slice(closeBraceIdx + 1);
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Step 7: for-loops over ranges and collections.
  // ---------------------------------------------------------------------
  function transpileForLoops(code) {
    var out = code;

    // for (i in a..b)         -> for (let i = a; i <= b; i++)
    // for (i in a until b)    -> for (let i = a; i < b; i++)
    // for (i in b downTo a)   -> for (let i = b; i >= a; i--)
    // Bounds are restricted to `[^()\n]` (no parens/newlines) so a lazy
    // match can never leak past this loop's own closing `)` and swallow
    // an unrelated `for` loop that happens to contain `..` further down.
    var rangeRe = /for\s*\(\s*([A-Za-z_]\w*)\s+in\s+([^()\n]+?)\.\.([^()\n]+?)\)/;
    var guard = 0;
    while (true) {
      var m = rangeRe.exec(out);
      if (!m || guard++ > 300) break;
      var v = m[1], start = m[2].trim(), end = m[3].trim();
      var repl = 'for (let ' + v + ' = ' + start + '; ' + v + ' <= ' + end + '; ' + v + '++)';
      out = out.slice(0, m.index) + repl + out.slice(m.index + m[0].length);
    }

    var untilRe = /for\s*\(\s*([A-Za-z_]\w*)\s+in\s+([^()\n]+?)\s+until\s+([^()\n]+?)\)/;
    guard = 0;
    while (true) {
      var m2 = untilRe.exec(out);
      if (!m2 || guard++ > 300) break;
      var v2 = m2[1], start2 = m2[2].trim(), end2 = m2[3].trim();
      var repl2 = 'for (let ' + v2 + ' = ' + start2 + '; ' + v2 + ' < ' + end2 + '; ' + v2 + '++)';
      out = out.slice(0, m2.index) + repl2 + out.slice(m2.index + m2[0].length);
    }

    var downToRe = /for\s*\(\s*([A-Za-z_]\w*)\s+in\s+([^()\n]+?)\s+downTo\s+([^()\n]+?)\)/;
    guard = 0;
    while (true) {
      var m3 = downToRe.exec(out);
      if (!m3 || guard++ > 300) break;
      var v3 = m3[1], start3 = m3[2].trim(), end3 = m3[3].trim();
      var repl3 = 'for (let ' + v3 + ' = ' + start3 + '; ' + v3 + ' >= ' + end3 + '; ' + v3 + '--)';
      out = out.slice(0, m3.index) + repl3 + out.slice(m3.index + m3[0].length);
    }

    // for (item in collection) -> for (const item of collection)
    var forInRe = /for\s*\(\s*([A-Za-z_]\w*)\s+in\s+([^()\n]+)\)/;
    guard = 0;
    while (true) {
      var m4 = forInRe.exec(out);
      if (!m4 || guard++ > 300) break;
      var v4 = m4[1], coll = m4[2].trim();
      var repl4 = 'for (const ' + v4 + ' of ' + coll + ')';
      out = out.slice(0, m4.index) + repl4 + out.slice(m4.index + m4[0].length);
    }

    return out;
  }

  // ---------------------------------------------------------------------
  // Step 8: val/var declarations & leftover type annotations.
  // ---------------------------------------------------------------------
  function transpileValVar(code) {
    var out = code.replace(/\bval\s+/g, 'const ');
    out = out.replace(/\bvar\s+/g, 'let ');
    // "const x: Int = 5"  ->  "const x = 5"
    out = out.replace(/\b(const|let)\s+([A-Za-z_]\w*)\s*:\s*[\w<>\[\]\.\?]+(\s*=)/g, '$1 $2$3');
    // "const x: Int" (no initializer)
    out = out.replace(/\b(const|let)\s+([A-Za-z_]\w*)\s*:\s*[\w<>\[\]\.\?]+/g, '$1 $2');
    return out;
  }

  // ---------------------------------------------------------------------
  // Step 9: collection factory functions.
  // ---------------------------------------------------------------------
  function transpileCollections(code) {
    var out = code;
    out = out.replace(/\b(mutableListOf|listOf|arrayOf|mutableSetOf)\s*\(/g, function (m, fn) {
      return fn === 'mutableSetOf' ? 'Array.from(new Set([' : '[';
    });
    // naive close-paren fixups aren't reliable via regex across nested calls,
    // so instead just alias them as functions returning arrays (see runtime prelude).
    out = code
      .replace(/\bmutableListOf\s*\(/g, '__kt_listOf(')
      .replace(/\blistOf\s*\(/g, '__kt_listOf(')
      .replace(/\barrayOf\s*\(/g, '__kt_listOf(')
      .replace(/\bmutableSetOf\s*\(/g, '__kt_setOf(')
      .replace(/\bsetOf\s*\(/g, '__kt_setOf(')
      .replace(/\bmutableMapOf\s*\(/g, '__kt_mapOf(')
      .replace(/\bmapOf\s*\(/g, '__kt_mapOf(');
    // infix "to" used for Pair / map entries: `"a" to 1` -> `["a", 1]`
    out = out.replace(/([^\s,(]+)\s+to\s+([^\s,)]+)/g, '[$1, $2]');
    return out;
  }

  // ---------------------------------------------------------------------
  // Step 10: misc operators & builtins.
  // ---------------------------------------------------------------------
  function transpileMisc(code) {
    var out = code;
    out = out.replace(/\?\:/g, '??');       // Elvis operator
    out = out.replace(/!!/g, '');           // non-null assertion (best effort)
    out = out.replace(/\bprintln\s*\(/g, 'console.log(');
    out = out.replace(/\bprint\s*\(/g, 'console.log(');
    out = out.replace(/\.size\b(?!\()/g, '.length');
    out = out.replace(/\btrue\b/g, 'true').replace(/\bfalse\b/g, 'false');
    return out;
  }

  // ---------------------------------------------------------------------
  // Step 11: trailing lambdas — `list.map { it * 2 }` / `{ x -> x + 1 }`
  // ---------------------------------------------------------------------
  function wrapLambdaBody(body) {
    var stmts = splitTopLevel(body).map(function (s) { return s.trim(); }).filter(Boolean);
    if (stmts.length === 0) return '{}';
    var last = stmts[stmts.length - 1];
    if (!/^return\b/.test(last)) {
      if (last.endsWith(';')) last = last.slice(0, -1);
      stmts[stmts.length - 1] = 'return ' + last + ';';
    }
    return '{ ' + stmts.join('; ') + ' }';
  }

  var CLASS_HEADER_RE = /\b(class|interface|object)\s+[A-Za-z_]\w*\s*(\([^()]*\))?\s*(:\s*[A-Za-z_][\w.]*\s*(\([^()]*\))?)?\s*$/;
  var FUN_HEADER_RE = /\bfun\s+(?:[A-Za-z_][\w.<>]*\.)?[A-Za-z_]\w*\s*\([^()]*\)\s*(:\s*[\w<>?,.\s\[\]]+)?\s*$/;

  function transpileLambdas(code) {
    var out = '';
    var i = 0;
    while (i < code.length) {
      if (code[i] === '{') {
        var before = out.replace(/\s+$/, '');
        var precededByWord = /[\w)\]]$/.test(before);
        var lastWordMatch = before.match(/([A-Za-z_]\w*)\s*(\([^()]*\))?$/);
        var lastWord = lastWordMatch ? lastWordMatch[1] : '';
        var controlKeywords = ['if', 'else', 'for', 'while', 'do', 'try', 'catch', 'finally', 'fun', 'function', 'init'];
        var isControl = controlKeywords.indexOf(lastWord) !== -1 ||
          CLASS_HEADER_RE.test(before) || FUN_HEADER_RE.test(before);
        // Function/class/if/for/etc. headers close with `)` (or a bare class
        // name for parameterless classes/objects, caught by CLASS_HEADER_RE)
        // right before their body brace. A bare trailing lambda like
        // `.map { ... }` or `run { ... }` is preceded by a plain identifier
        // with no such header, so it's safe to treat as a lambda.
        var closeParenBeforeBrace = /\)\s*$/.test(before);
        var isLambdaCandidate = precededByWord && !isControl && !closeParenBeforeBrace;

        if (isLambdaCandidate) {
          var closeIdx = findMatchingBrace(code, i);
          if (closeIdx !== -1) {
            var inner = code.slice(i + 1, closeIdx);
            var arrowMatch = inner.match(/^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*->([\s\S]*)$/);
            var params, body;
            if (arrowMatch) {
              params = arrowMatch[1].split(',').map(function (s) { return s.trim(); }).join(', ');
              body = arrowMatch[2];
            } else {
              params = 'it';
              body = inner;
            }
            var transformedBody = transpileLambdas(body);
            out += '((' + params + ') => ' + wrapLambdaBody(transformedBody) + ')';
            i = closeIdx + 1;
            continue;
          }
        }
      }
      out += code[i];
      i++;
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Runtime prelude injected before every program.
  // ---------------------------------------------------------------------
  var PRELUDE =
    'function __kt_listOf(){return Array.prototype.slice.call(arguments);}\n' +
    'function __kt_setOf(){return new Set(Array.prototype.slice.call(arguments));}\n' +
    'function __kt_mapOf(){return new Map(Array.prototype.slice.call(arguments));}\n';

  // ---------------------------------------------------------------------
  // Public: transpile Kotlin source -> JavaScript source.
  // ---------------------------------------------------------------------
  function transpile(kotlinSource) {
    var protectedResult = protectStrings(kotlinSource);
    var code = protectedResult.code;

    code = stripComments(code);
    code = stripPackageImports(code);
    // Lambdas are resolved first, while `class`/`fun`/`if`/`for`/`when`
    // headers still look like Kotlin (ending in `)` or a bare class name),
    // which is what lets the lambda heuristic tell a trailing lambda block
    // apart from an ordinary control-flow / declaration body.
    code = transpileLambdas(code);
    var classResult = transpileClasses(code);
    code = classResult.code;
    code = transpileFunctions(code);
    code = transpileWhen(code);
    code = transpileForLoops(code);
    code = transpileValVar(code);
    code = transpileCollections(code);
    code = transpileMisc(code);
    code = instantiateClasses(code, classResult.classNames);

    code = restoreStrings(code, protectedResult.vault);

    var out = PRELUDE + code;
    if (/function\s+main\s*\(/.test(code)) {
      out += '\nif (typeof main === "function") { main(); }\n';
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Public: transpile + execute Kotlin source in the current context.
  // ---------------------------------------------------------------------
  function run(kotlinSource, opts) {
    opts = opts || {};
    var js = transpile(kotlinSource);
    try {
      if (typeof window !== 'undefined' && !opts.isolate) {
        // eslint-disable-next-line no-eval
        (0, eval)(js);
      } else {
        // eslint-disable-next-line no-new-func
        new Function(js)();
      }
    } catch (err) {
      console.error('[Kotlin.js] Runtime error:', err);
      console.error('[Kotlin.js] Generated JS:\n' + js);
      throw err;
    }
    return js;
  }

  // ---------------------------------------------------------------------
  // Browser bootstrap: scan the document for <script type="text/kotlin">
  // ---------------------------------------------------------------------
  function bootstrap() {
    if (typeof document === 'undefined') return;

    function runScriptTag(tag) {
      if (tag.src) {
        fetch(tag.src)
          .then(function (r) { return r.text(); })
          .then(function (src) { run(src); })
          .catch(function (err) {
            console.error('[Kotlin.js] Failed to load ' + tag.src, err);
          });
      } else {
        run(tag.textContent);
      }
    }

    function scan() {
      var tags = document.querySelectorAll('script[type="text/kotlin"]');
      for (var i = 0; i < tags.length; i++) runScriptTag(tags[i]);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scan);
    } else {
      scan();
    }
  }

  bootstrap();

  return {
    transpile: transpile,
    run: run,
    version: '1.0.0'
  };
}));