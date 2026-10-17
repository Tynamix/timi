import AppKit
import Foundation

// Vector artwork in the 1254-point reference's top-left coordinate system.
// An explicit sRGB bitmap keeps output at 1024 x 1024 on every display.
let size = 1024
let designSize: CGFloat = 1254
let context = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
context.translateBy(x: 0, y: CGFloat(size))
context.scaleBy(x: CGFloat(size) / designSize, y: -CGFloat(size) / designSize)

let forest = NSColor(srgbRed: 34 / 255, green: 88 / 255, blue: 79 / 255, alpha: 1)
let lime = NSColor(srgbRed: 216 / 255, green: 236 / 255, blue: 153 / 255, alpha: 1)
let ivory = NSColor(srgbRed: 244 / 255, green: 241 / 255, blue: 230 / 255, alpha: 1)

func stroke(_ path: NSBezierPath, width: CGFloat, color: NSColor) {
    color.setStroke()
    path.lineWidth = width
    path.lineCapStyle = .round
    path.lineJoinStyle = .round
    path.stroke()
}

// Transparent outer corners let macOS supply the surrounding surface.
forest.setFill()
NSBezierPath(
    roundedRect: NSRect(x: 74, y: 74, width: 1107, height: 1104),
    xRadius: 250, yRadius: 250
).fill()

// The t forms the clock's left side. Its stem is slightly heavier than its
// curved foot and crossbar, following the reference's proportions.
let t = NSBezierPath()
t.move(to: NSPoint(x: 322, y: 221))
t.curve(to: NSPoint(x: 367, y: 267),
        controlPoint1: NSPoint(x: 347, y: 221), controlPoint2: NSPoint(x: 367, y: 241))
t.line(to: NSPoint(x: 365, y: 743))
t.curve(to: NSPoint(x: 549, y: 938),
        controlPoint1: NSPoint(x: 365, y: 855), controlPoint2: NSPoint(x: 437, y: 938))
t.line(to: NSPoint(x: 575, y: 938))
t.curve(to: NSPoint(x: 614, y: 977),
        controlPoint1: NSPoint(x: 597, y: 938), controlPoint2: NSPoint(x: 614, y: 955))
t.curve(to: NSPoint(x: 575, y: 1014),
        controlPoint1: NSPoint(x: 614, y: 998), controlPoint2: NSPoint(x: 597, y: 1014))
t.line(to: NSPoint(x: 548, y: 1014))
t.curve(to: NSPoint(x: 276, y: 746),
        controlPoint1: NSPoint(x: 384, y: 1014), controlPoint2: NSPoint(x: 276, y: 908))
t.line(to: NSPoint(x: 276, y: 267))
t.curve(to: NSPoint(x: 322, y: 221),
        controlPoint1: NSPoint(x: 276, y: 241), controlPoint2: NSPoint(x: 296, y: 221))
t.close()
lime.setFill()
t.fill()
NSBezierPath(
    roundedRect: NSRect(x: 190, y: 372, width: 422, height: 80),
    xRadius: 40, yRadius: 40
).fill()

// The D-shaped rim leaves openings above and below the hand's axis.
let rim = NSBezierPath()
rim.move(to: NSPoint(x: 699, y: 409))
rim.line(to: NSPoint(x: 772, y: 409))
rim.curve(to: NSPoint(x: 1023, y: 694),
          controlPoint1: NSPoint(x: 917, y: 409), controlPoint2: NSPoint(x: 1023, y: 532))
rim.line(to: NSPoint(x: 1023, y: 710))
rim.curve(to: NSPoint(x: 750, y: 977),
          controlPoint1: NSPoint(x: 1023, y: 880), controlPoint2: NSPoint(x: 917, y: 977))
rim.line(to: NSPoint(x: 697, y: 977))
stroke(rim, width: 74, color: ivory)

// The long hand and lime dot form the i; the short hand points to two.
let minuteHand = NSBezierPath()
minuteHand.move(to: NSPoint(x: 637, y: 525))
minuteHand.line(to: NSPoint(x: 637, y: 728))
stroke(minuteHand, width: 72, color: ivory)

let hourHand = NSBezierPath()
hourHand.move(to: NSPoint(x: 637, y: 728))
hourHand.line(to: NSPoint(x: 811, y: 637))
stroke(hourHand, width: 68, color: ivory)
ivory.setFill()
NSBezierPath(ovalIn: NSRect(x: 593, y: 681, width: 96, height: 96)).fill()

lime.setFill()
NSBezierPath(ovalIn: NSRect(x: 584, y: 236, width: 106, height: 106)).fill()

NSGraphicsContext.restoreGraphicsState()
let bitmap = NSBitmapImageRep(cgImage: context.makeImage()!)
try bitmap.representation(using: .png, properties: [:])!.write(
    to: URL(fileURLWithPath: CommandLine.arguments[1])
)
