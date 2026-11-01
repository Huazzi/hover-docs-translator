/** Provides greeting examples for documentation readers. */
public class Sample {
    /**
     * Returns a Java greeting for the supplied reader.
     * @param name the reader name to greet
     * @return the greeting text
     * @throws IllegalArgumentException if the name is empty
     */
    public static String greetReader(String name) {
        if (name.isEmpty()) throw new IllegalArgumentException("name");
        return "Hello " + name;
    }

    /**
     * Returns the supplied Java text without modification.
     * @param value the text to return
     * @return the original text
     */
    public static String echoReader(String value) { return value; }

    public static void main(String[] args) {
        greetReader("reader");
        echoReader("reader");
    }
}
