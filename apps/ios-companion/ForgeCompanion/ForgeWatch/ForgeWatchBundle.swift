//
//  ForgeWatchBundle.swift
//  ForgeWatch
//
//  Created by Omar Claw on 07.04.2026.
//

import WidgetKit
import SwiftUI

@main
struct ForgeWatchBundle: WidgetBundle {
    var body: some Widget {
        ForgeWatch()
        if #available(iOS 18.0, *) {
            ForgeWatchControl()
        }
    }
}
