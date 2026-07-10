//
//  ForgeCompanionUITests.swift
//  ForgeCompanionUITests
//
//  Created by Omar Claw on 05.04.2026.
//

import XCTest

final class ForgeCompanionUITests: XCTestCase {

    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.

        // In UI tests it is usually best to stop immediately when a failure occurs.
        continueAfterFailure = false

        // In UI tests it’s important to set the initial state - such as interface orientation - required for your tests before they run. The setUp method is a good place to do this.
    }

    override func tearDownWithError() throws {
        // Put teardown code here. This method is called after the invocation of each test method in the class.
    }

    @MainActor
    func testExample() throws {
        // UI tests must launch the application that they test.
        let app = makeApp()
        app.launch()

        // Use XCTAssert and related functions to verify your tests produce the correct results.
    }

    @MainActor
    func testPairingSetupFlowPrioritizesForgeQRAndManualFallback() throws {
        let app = makeApp()
        app.launchEnvironment["FORGE_SCREENSHOT_SCENARIO"] = "pairing"
        app.launch()

        XCTAssertTrue(app.staticTexts["Set up sync"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["Choose your Forge connection."].exists)

        let scanButton = app.buttons["Scan Forge QR"]
        XCTAssertTrue(scanButton.waitForExistence(timeout: 8))
        XCTAssertTrue(scanButton.isHittable)

        let manualButton = app.buttons["Manual connection"]
        XCTAssertTrue(manualButton.waitForExistence(timeout: 2))
        XCTAssertTrue(manualButton.isHittable)

        scanButton.tap()

        XCTAssertTrue(app.staticTexts["Scan your Forge QR."].waitForExistence(timeout: 5))
        XCTAssertTrue(scrollUntilHittable(app.buttons["Open camera scanner"], in: app))
        XCTAssertTrue(scrollUntilHittable(app.buttons["Paste pairing payload"], in: app))
    }

    @MainActor
    func testMovementTimelineSelectedActionButtonsAreTappable() throws {
        let app = makeApp()
        app.launchEnvironment["FORGE_SCREENSHOT_SCENARIO"] = "life-timeline"
        app.launch()

        XCTAssertTrue(app.staticTexts["Life Timeline"].waitForExistence(timeout: 8))
        attachScreenshot(named: "Life Timeline initial state")

        let segmentButtons = app.buttons.matching(identifier: "MovementTimelineStaySegmentButton")
        XCTAssertTrue(segmentButtons.firstMatch.waitForExistence(timeout: 8))
        XCTAssertTrue(tapFirstHittable(in: segmentButtons), "No hittable movement timeline segment was available.")

        let labelButton = app.buttons["MovementTimelineInlineLabelLocationButton"]
        if labelButton.waitForExistence(timeout: 5) == false {
            XCTFail("Inline label button did not appear after selecting a stay.\n\(app.debugDescription)")
        }
        XCTAssertTrue(labelButton.isHittable)
        labelButton.tap()

        XCTAssertTrue(app.navigationBars["Set Location Label"].waitForExistence(timeout: 5))
        app.buttons["Cancel"].tap()

        let detailsButton = app.buttons["MovementTimelineInlineDetailsButton"]
        XCTAssertTrue(detailsButton.waitForExistence(timeout: 5))
        XCTAssertTrue(detailsButton.isHittable)
        detailsButton.tap()

        let sheetLabelButton = app.buttons["MovementTimelineDetailSheetLabelLocationButton"]
        XCTAssertTrue(sheetLabelButton.waitForExistence(timeout: 5))
        XCTAssertTrue(
            scrollUntilHittable(sheetLabelButton, in: app),
            "Detail-sheet label action was not reachable.\n\(app.debugDescription)"
        )
        sheetLabelButton.tap()

        XCTAssertTrue(app.navigationBars["Set Location Label"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testLaunchPerformance() throws {
        // This measures how long it takes to launch your application.
        measure(metrics: [XCTApplicationLaunchMetric()]) {
            makeApp().launch()
        }
    }

    private func makeApp() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["FORGE_COMPANION_DISABLE_SIMULATOR_AUTOMATION"] = "1"
        return app
    }

    private func attachScreenshot(named name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func scrollUntilHittable(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
        guard element.waitForExistence(timeout: 3) else {
            return false
        }
        for _ in 0..<5 {
            if element.isHittable {
                return true
            }
            app.swipeUp()
        }
        return element.isHittable
    }

    private func tapFirstHittable(in query: XCUIElementQuery) -> Bool {
        for index in 0..<min(query.count, 12) {
            let element = query.element(boundBy: index)
            if element.exists,
               element.isHittable,
               element.frame.midY > 140,
               element.frame.midY < 820
            {
                element.tap()
                return true
            }
        }
        return false
    }
}
