const K = require('./src/kotlin.js');

function section(title, code) {
  console.log('\n=== ' + title + ' ===');
  console.log('--- kotlin ---');
  console.log(code);
  const js = K.transpile(code);
  console.log('--- js ---');
  console.log(js);
  console.log('--- output ---');
  try {
    new Function(js)();
  } catch (e) {
    console.log('ERROR: ' + e.message);
  }
}

section('hello world', `
fun main() {
    val name = "World"
    println("Hello, $name!")
}
`);

section('val/var + arithmetic', `
fun main() {
    val a = 5
    var b = 10
    b += a
    println("sum = " + b)
}
`);

section('for range', `
fun main() {
    for (i in 1..5) {
        println(i)
    }
}
`);

section('for until / downTo', `
fun main() {
    for (i in 0 until 3) { println("u:" + i) }
    for (i in 3 downTo 1) { println("d:" + i) }
}
`);

section('for in list', `
fun main() {
    val items = listOf(1, 2, 3)
    for (x in items) {
        println(x)
    }
}
`);

section('if/else', `
fun main() {
    val x = 7
    if (x > 5) {
        println("big")
    } else {
        println("small")
    }
}
`);

section('when expression', `
fun main() {
    val x = 2
    val result = when (x) {
        1 -> "one"
        2, 3 -> "two or three"
        in 10..20 -> "in range"
        else -> "other"
    }
    println(result)
}
`);

section('function with types', `
fun square(x: Int): Int {
    return x * x
}
fun main() {
    println(square(5))
}
`);

section('single expression function', `
fun square(x: Int): Int = x * x
fun main() {
    println(square(6))
}
`);

section('class with primary constructor', `
class Person(val name: String, var age: Int) {
    fun greet() {
        println("Hi, I'm " + name)
    }
}
fun main() {
    val p = Person("Ada", 30)
    p.greet()
    println(p.age)
}
`);

section('data class', `
data class Point(val x: Int, val y: Int)
fun main() {
    val p = Point(1, 2)
    println(p.toString())
}
`);

section('lambda / map filter', `
fun main() {
    val nums = listOf(1, 2, 3, 4)
    val doubled = nums.map { it * 2 }
    val evens = nums.filter { x -> x % 2 == 0 }
    println(doubled)
    println(evens)
}
`);

section('elvis operator', `
fun main() {
    val name: String? = null
    val display = name ?: "Unknown"
    println(display)
}
`);

section('string template with expr', `
fun main() {
    val list = listOf(1,2,3)
    println("size = ${'$'}{list.size}")
}
`);