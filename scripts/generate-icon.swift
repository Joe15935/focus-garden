import AppKit
let size: CGFloat = 1024
let bitmap = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:1024,pixelsHigh:1024,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:bitmap)
NSColor.clear.setFill(); NSRect(x:0,y:0,width:size,height:size).fill()
let bg=NSBezierPath(roundedRect:NSRect(x:40,y:40,width:944,height:944),xRadius:212,yRadius:212)
NSGradient(starting:NSColor(red:0.96,green:0.92,blue:0.80,alpha:1),ending:NSColor(red:0.85,green:0.87,blue:0.70,alpha:1))!.draw(in:bg,angle:90)
let soil=NSBezierPath(ovalIn:NSRect(x:250,y:210,width:524,height:110)); NSColor(red:0.49,green:0.34,blue:0.22,alpha:0.16).setFill();soil.fill()
let pot=NSBezierPath(); pot.move(to:NSPoint(x:320,y:410));pot.line(to:NSPoint(x:704,y:410));pot.line(to:NSPoint(x:657,y:238));pot.curve(to:NSPoint(x:367,y:238),controlPoint1:NSPoint(x:613,y:185),controlPoint2:NSPoint(x:411,y:185));pot.close()
NSColor(red:0.70,green:0.38,blue:0.24,alpha:1).setFill();pot.fill()
NSBezierPath(roundedRect:NSRect(x:292,y:387,width:440,height:61),xRadius:25,yRadius:25).fill()
let stem=NSBezierPath();stem.move(to:NSPoint(x:511,y:410));stem.curve(to:NSPoint(x:526,y:721),controlPoint1:NSPoint(x:487,y:519),controlPoint2:NSPoint(x:554,y:617));stem.lineWidth=28;stem.lineCapStyle = .round;NSColor(red:0.20,green:0.36,blue:0.24,alpha:1).setStroke();stem.stroke()
func leaf(_ a:NSPoint,_ b:NSPoint,_ c:NSPoint,_ d:NSPoint,_ e:NSPoint,_ f:NSPoint, color:NSColor){ let p=NSBezierPath();p.move(to:a);p.curve(to:b,controlPoint1:c,controlPoint2:d);p.curve(to:a,controlPoint1:e,controlPoint2:f);color.setFill();p.fill() }
leaf(NSPoint(x:515,y:550),NSPoint(x:270,y:706),NSPoint(x:426,y:748),NSPoint(x:288,y:737),NSPoint(x:257,y:553),NSPoint(x:420,y:520),color:NSColor(red:0.30,green:0.47,blue:0.29,alpha:1))
leaf(NSPoint(x:520,y:617),NSPoint(x:741,y:813),NSPoint(x:548,y:823),NSPoint(x:683,y:840),NSPoint(x:770,y:654),NSPoint(x:641,y:586),color:NSColor(red:0.38,green:0.56,blue:0.33,alpha:1))
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
