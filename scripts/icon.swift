import AppKit
import Foundation

let size = 1024
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()
NSColor(calibratedRed: 0.13, green: 0.27, blue: 0.23, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 65, y: 65, width: 894, height: 894), xRadius: 210, yRadius: 210).fill()
NSColor(calibratedRed: 0.94, green: 0.93, blue: 0.86, alpha: 1).setStroke()
let clock = NSBezierPath(ovalIn: NSRect(x: 260, y: 260, width: 504, height: 504))
clock.lineWidth = 46
clock.stroke()
let hands = NSBezierPath()
hands.move(to: NSPoint(x: 512, y: 686))
hands.line(to: NSPoint(x: 512, y: 512))
hands.line(to: NSPoint(x: 637, y: 436))
hands.lineWidth = 46
hands.lineCapStyle = .round
hands.lineJoinStyle = .round
hands.stroke()
NSColor(calibratedRed: 0.80, green: 0.90, blue: 0.53, alpha: 1).setFill()
NSBezierPath(ovalIn: NSRect(x: 759, y: 749, width: 102, height: 102)).fill()
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
