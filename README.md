# Kotlin.js

Пишите код на Kotlin прямо в `<script>` или в `.js`-файле — библиотека
транспилирует его в JavaScript и выполняет в браузере. Никакой сборки,
никакого JVM/Kotlin-компилятора — только один файл `kotlin.js`.

```html
<script src="kotlin.js"></script>

<script type="text/kotlin">
    fun main() {
        val name = "World"
        println("Hello, $name!")
    }
</script>
```

> ⚠️ Тег обязательно должен быть `<script type="text/kotlin">`, а не
> `type="kotlin"` — так требует HTML-спецификация для нестандартных типов
> скриптов (браузер должен получить `type` со слэшем, иначе тег будет
> проигнорирован как `text/javascript` по умолчанию).

## Установка

```bash
npm install @asknl/kotlin
```

или просто подключите файл из `node_modules/@asnl/kotlin/src/kotlin.js`
(или через unpkg/jsDelivr):

```html
<script src="https://unpkg.com/@asnl/kotlin/src/kotlin.js"></script>
```

## Использование

### 1. Inline `<script type="text/kotlin">`

```html
<script src="kotlin.js"></script>
<script type="text/kotlin">
    fun main() {
        println("Работает!")
    }
</script>
```

Библиотека сама сканирует документ после загрузки и выполняет каждый такой
тег по порядку.

### 2. Внешний `.js`-файл с Kotlin-кодом внутри

Файл может называться как угодно (например `app.kt.js`), физическое
расширение `.js` значения не имеет — важен `type` тега, который его
подключает:

```html
<script type="text/kotlin" src="app.kt.js"></script>
```

```kotlin
// app.kt.js
fun main() {
    val nums = listOf(1, 2, 3)
    println(nums.map { it * it })
}
```

### 3. Программный API

```html
<script src="kotlin.js"></script>
<script>
    // Транспилировать в текст JS, ничего не выполняя:
    const js = KotlinJS.transpile('val x = 5\nprintln(x)');

    // Транспилировать и сразу выполнить:
    KotlinJS.run('println("Hi from JS-land")');
</script>
```

### 4. Node.js / бандлеры

```js
const KotlinJS = require('kotlin.js');
KotlinJS.transpile('fun main() { println("hi") }');
```

## Что поддерживается

| Kotlin | Пример | Во что превращается |
|---|---|---|
| `val` / `var` | `val x = 5` | `const x = 5` / `let x = 5` |
| Строковые шаблоны | `"Hi $name, ${a+b}"` | `` `Hi ${name}, ${a+b}` `` |
| Функции | `fun f(x: Int): Int { ... }` | `function f(x) { ... }` |
| Функция-выражение | `fun sq(x: Int) = x*x` | `function sq(x) { return x*x; }` |
| `if` / `else` | как в Kotlin | без изменений (синтаксис совпадает) |
| `when` | `when (x) { 1 -> ...; else -> ... }` | цепочка `if / else if` |
| `for (i in a..b)` | диапазон | классический `for` |
| `for (i in a until b)` / `downTo` | | `for` с `<` / `--` |
| `for (x in list)` | | `for...of` |
| Классы + первичный конструктор | `class P(val x: Int)` | ES6 `class` с `constructor` |
| `data class` | генерируется `toString()` | обычный класс + `toString()` |
| Лямбды | `list.map { it * 2 }` | `list.map((it) => { return it*2; })` |
| `listOf` / `mutableListOf` / `arrayOf` | | обычный массив |
| `setOf` / `mapOf` | | `Set` / `Map` |
| Элвис-оператор `?:` | `a ?: b` | `a ?? b` |
| `println` / `print` | | `console.log` |
| `.size` | | `.length` |
| `package` / `import` | | игнорируются |

При наличии `fun main()` в коде библиотека вызывает его автоматически
после транспиляции — точно так же, как это делает настоящий Kotlin.

## Ограничения

Это **транспайлер подмножества Kotlin**, а не полноценный компилятор
Kotlin/JS от JetBrains. Он написан как набор трансформаций текста и
рассчитан на «бытовой» код — учебные примеры, демо, прототипы. Он **не**
поддерживает: null-safety на уровне типов (ошибки будут только в
рантайме, как в обычном JS), sealed-классы, корутины, generics-инференс,
sealed/enum классы, области видимости `companion object`, аннотации,
рефлексию, стандартную библиотеку Kotlin целиком (доступны только
`listOf/mutableListOf/arrayOf/setOf/mapOf`, `println/print`, `.size`,
конструкции `..`/`until`/`downTo`). Сложные вложенные лямбды и `when` с
нетривиальными шаблонами (`is Type`, диапазоны) поддерживаются на
базовом уровне — для чего-то более серьёзного используйте официальный
Kotlin/JS.

## Разработка

```bash
npm test   # прогоняет test.js — набор сквозных проверок транспайлера
```

## Лицензия

ISC