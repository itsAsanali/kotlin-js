// This is a regular .js file on disk — but its *contents* are Kotlin.
// Load it with: <script type="text/kotlin" src="app.kt.js"></script>

data class Point(val x: Int, val y: Int) {
    fun distanceFromOrigin(): Int {
        return x * x + y * y
    }
}

fun describe(p: Point): String {
    return "Point at (${p.x}, ${p.y})"
}

fun main() {
    val points = listOf(Point(1, 2), Point(3, 4), Point(0, 0))

    for (p in points) {
        println(describe(p))
    }

    val farthest = points.filter { it.distanceFromOrigin() > 0 }
    println("Non-origin points: " + farthest.size)

    for (i in 1..3) {
        val label = when (i) {
            1 -> "first"
            2 -> "second"
            else -> "other"
        }
        println(i.toString() + " -> " + label)
    }
}