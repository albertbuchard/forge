import AppKit
import CryptoKit
import Foundation
import Vision

private enum VerificationError: Error, CustomStringConvertible {
  case duplicateCapture(surface: String, priorSurface: String)
  case imageUnreadable(String)
  case missingExpectedContent(surface: String, expected: [String], recognized: [String])
  case missingExpectedTitle(expected: String, recognized: [String])

  var description: String {
    switch self {
    case .duplicateCapture(let surface, let priorSurface):
      return "The \(surface) screenshot duplicates the accepted \(priorSurface) screenshot."
    case .imageUnreadable(let path):
      return "The screenshot could not be read: \(path)"
    case .missingExpectedContent(let surface, let expected, let recognized):
      let evidence = recognized.isEmpty ? "no text" : recognized.joined(separator: " | ")
      return "The \(surface) screenshot did not contain any expected ready-state content "
        + "(\(expected.joined(separator: ", "))); recognized \(evidence)."
    case .missingExpectedTitle(let expected, let recognized):
      let evidence = recognized.isEmpty ? "no text" : recognized.joined(separator: " | ")
      return "Expected the rendered title '\(expected)', but recognized \(evidence)."
    }
  }
}

private let expectedContentAnchors: [String: [String]] = [
  "now": ["Habits", "Prompts", "Moment"],
  "work": ["Active Run", "Credited", "Mode"],
  "habits": ["Streak", "Tap to check in", "Current period captured"],
  "psyche": ["Mood check", "Focused", "Tense"],
  "health": ["Vitals", "HR samples", "Mark recovery"],
  "sync": ["Captures", "Receipts", "Refresh"],
]

private func normalized(_ value: String) -> String {
  value
    .folding(
      options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX")
    )
    .split(whereSeparator: \.isWhitespace)
    .joined(separator: " ")
    .trimmingCharacters(in: .whitespacesAndNewlines)
}

private func recognizedLines(in screenshotPath: String) throws -> [String] {
  guard
    let image = NSImage(contentsOfFile: screenshotPath),
    let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
  else {
    throw VerificationError.imageUnreadable(screenshotPath)
  }

  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = false
  try VNImageRequestHandler(cgImage: cgImage).perform([request])
  return (request.results ?? []).compactMap { observation in
    observation.topCandidates(1).first?.string
  }
}

private func screenshotSha256(_ screenshotPath: String) throws -> String {
  let data = try Data(contentsOf: URL(fileURLWithPath: screenshotPath))
  return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func requireExpectedTitle(
  screenshotPath: String,
  expectedTitle: String
) throws {
  let recognized = try recognizedLines(in: screenshotPath)
  guard recognized.contains(where: { normalized($0) == normalized(expectedTitle) }) else {
    throw VerificationError.missingExpectedTitle(expected: expectedTitle, recognized: recognized)
  }
}

private func requireExpectedContent(
  recognized: [String],
  surface: String
) throws {
  guard let anchors = expectedContentAnchors[surface] else {
    throw VerificationError.missingExpectedContent(
      surface: surface,
      expected: [],
      recognized: recognized
    )
  }
  let recognizedText = normalized(recognized.joined(separator: " "))
  guard anchors.contains(where: { recognizedText.contains(normalized($0)) }) else {
    throw VerificationError.missingExpectedContent(
      surface: surface,
      expected: anchors,
      recognized: recognized
    )
  }
}

@discardableResult
private func verify(
  screenshotPath: String,
  expectedTitle: String,
  surface: String,
  seenHashesPath: String
) throws -> String {
  let recognized = try recognizedLines(in: screenshotPath)
  guard recognized.contains(where: { normalized($0) == normalized(expectedTitle) }) else {
    throw VerificationError.missingExpectedTitle(expected: expectedTitle, recognized: recognized)
  }
  try requireExpectedContent(recognized: recognized, surface: surface)

  let sha256 = try screenshotSha256(screenshotPath)
  let seenPayload = (try? String(contentsOfFile: seenHashesPath, encoding: .utf8)) ?? ""
  for line in seenPayload.split(separator: "\n") {
    let fields = line.split(separator: "\t", maxSplits: 1).map(String.init)
    if fields.first == sha256 {
      throw VerificationError.duplicateCapture(
        surface: surface,
        priorSurface: fields.count > 1 ? fields[1] : "unknown"
      )
    }
  }
  let record = "\(sha256)\t\(surface)\n"
  if FileManager.default.fileExists(atPath: seenHashesPath) {
    let handle = try FileHandle(forWritingTo: URL(fileURLWithPath: seenHashesPath))
    try handle.seekToEnd()
    try handle.write(contentsOf: Data(record.utf8))
    try handle.close()
  } else {
    try record.write(toFile: seenHashesPath, atomically: true, encoding: .utf8)
  }
  return sha256
}

private func writeFixture(lines: [String], to url: URL) throws {
  let image = NSImage(size: NSSize(width: 416, height: 496))
  image.lockFocus()
  NSColor.black.setFill()
  NSRect(x: 0, y: 0, width: 416, height: 496).fill()
  if lines.isEmpty == false {
    let attributes: [NSAttributedString.Key: Any] = [
      .font: NSFont.systemFont(ofSize: 44, weight: .bold),
      .foregroundColor: NSColor.white,
    ]
    for (index, text) in lines.enumerated() {
      text.draw(
        at: NSPoint(x: 36, y: 390 - (index * 80)),
        withAttributes: attributes
      )
    }
  } else {
    NSColor.systemOrange.setFill()
    NSBezierPath(ovalIn: NSRect(x: 178, y: 218, width: 60, height: 60)).fill()
  }
  image.unlockFocus()
  guard
    let tiff = image.tiffRepresentation,
    let representation = NSBitmapImageRep(data: tiff),
    let png = representation.representation(using: .png, properties: [:])
  else {
    throw VerificationError.imageUnreadable(url.path)
  }
  try png.write(to: url)
}

private func selfTest() throws {
  let root = FileManager.default.temporaryDirectory
    .appendingPathComponent("forge-watch-screenshot-verifier-\(UUID().uuidString)")
  try FileManager.default.createDirectory(
    at: root,
    withIntermediateDirectories: false,
    attributes: [.posixPermissions: 0o700]
  )
  defer { try? FileManager.default.removeItem(at: root) }

  let rendered = root.appendingPathComponent("rendered.png")
  let headerOnly = root.appendingPathComponent("header-only.png")
  let loading = root.appendingPathComponent("loading.png")
  let seen = root.appendingPathComponent("seen.tsv")
  try writeFixture(lines: ["Work", "Active Run"], to: rendered)
  try writeFixture(lines: ["Work"], to: headerOnly)
  try writeFixture(lines: [], to: loading)
  _ = try verify(
    screenshotPath: rendered.path,
    expectedTitle: "Work",
    surface: "work",
    seenHashesPath: seen.path
  )

  do {
    _ = try verify(
      screenshotPath: loading.path,
      expectedTitle: "Habits",
      surface: "habits",
      seenHashesPath: seen.path
    )
    fatalError("A loading frame was accepted.")
  } catch VerificationError.missingExpectedTitle {
    // Expected.
  }

  do {
    _ = try verify(
      screenshotPath: headerOnly.path,
      expectedTitle: "Work",
      surface: "work",
      seenHashesPath: root.appendingPathComponent("header-seen.tsv").path
    )
    fatalError("A header-only loading frame was accepted.")
  } catch VerificationError.missingExpectedContent {
    // Expected.
  }

  do {
    _ = try verify(
      screenshotPath: rendered.path,
      expectedTitle: "Work",
      surface: "work",
      seenHashesPath: seen.path
    )
    fatalError("A duplicate screenshot was accepted.")
  } catch VerificationError.duplicateCapture {
    // Expected.
  }

  do {
    _ = try verify(
      screenshotPath: rendered.path,
      expectedTitle: "Psyche",
      surface: "psyche",
      seenHashesPath: root.appendingPathComponent("other-seen.tsv").path
    )
    fatalError("A screenshot with the wrong title was accepted.")
  } catch VerificationError.missingExpectedTitle {
    // Expected.
  }

  print("Watch screenshot verifier self-test passed.")
}

do {
  if CommandLine.arguments == [CommandLine.arguments[0], "--self-test"] {
    try selfTest()
  } else if CommandLine.arguments.count == 4 && CommandLine.arguments[1] == "--title-only" {
    try requireExpectedTitle(
      screenshotPath: CommandLine.arguments[2],
      expectedTitle: CommandLine.arguments[3]
    )
    print(CommandLine.arguments[3])
  } else {
    guard CommandLine.arguments.count == 5 else {
      fputs(
        "Usage: verify-watch-screenshot <screenshot> <expected-title> <surface> <seen-hashes-file>\n"
          + "   or: verify-watch-screenshot --title-only <screenshot> <expected-title>\n",
        stderr
      )
      exit(64)
    }
    let sha256 = try verify(
      screenshotPath: CommandLine.arguments[1],
      expectedTitle: CommandLine.arguments[2],
      surface: CommandLine.arguments[3],
      seenHashesPath: CommandLine.arguments[4]
    )
    print(sha256)
  }
} catch {
  fputs("\(error)\n", stderr)
  exit(2)
}
