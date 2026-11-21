export interface LanguageSpec {
  name: string;
  grammar: string;
  extensions: string[];
}
export const LANGUAGES: LanguageSpec[] = [
  { name: "Kotlin", grammar: "kotlin", extensions: [".kt", ".kts"] },
  { name: "Dart", grammar: "dart", extensions: [".dart"] },
  { name: "Scala", grammar: "scala", extensions: [".scala", ".sc"] },
  { name: "Bash", grammar: "bash", extensions: [".sh", ".bash"] },
  { name: "Go", grammar: "go", extensions: [".go"] },
  { name: "Rust", grammar: "rust", extensions: [".rs"] },
  { name: "Java", grammar: "java", extensions: [".java"] },
  { name: "C", grammar: "c", extensions: [".c", ".h"] },
  {
    name: "C++",
    grammar: "cpp",
    extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"],
  },
  { name: "C#", grammar: "c_sharp", extensions: [".cs"] },
  { name: "PHP", grammar: "php", extensions: [".php"] },
  { name: "Ruby", grammar: "ruby", extensions: [".rb", ".rake"] },
];
export const languageFor = (file: string) =>
  LANGUAGES.find((l) =>
    l.extensions.some((ext) => file.toLowerCase().endsWith(ext)),
  );
